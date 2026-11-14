"""Structural gravity (PPML) per basket, used as the "expected trade" baseline.

    E[v_ijt] = exp(b1 ln dist_ij + b2 contig_ij + b3 comlang_ij + b4 colony_ij + b5 rta_ijt
                   + exporter-year FE + importer-year FE)

MODELLING ASSUMPTION (approved by the owner on 2026-11-06): inside this model only,
country pairs with no recorded BACI flow count as zero trade. PPML needs zeros, and this is
standard practice. Everywhere else in TradeGraph, missing means "not recorded".
The country universe for year t is every country recorded in BACI that year (any product).
"""

from __future__ import annotations

from dataclasses import dataclass

import duckdb
import numpy as np
import pandas as pd
import pyfixest as pf

from tradegraph.models.covariates import BACI_TO_GRAVITY_ISO3

FORMULA = "value ~ ldist + contig + comlang + colony + rta + cov_missing | exp_year + imp_year"
COVARIATES = ["ldist", "contig", "comlang", "colony", "rta", "cov_missing"]
# Guard: fail if more than this share of observed (positive) trade value gets no prediction.
MAX_UNPREDICTED_VALUE_SHARE = 0.001


class GravityError(RuntimeError):
    pass


@dataclass
class GravityFit:
    basket_id: str
    coefficients: dict[str, dict[str, float]]  # name -> {estimate, se}
    n_obs: int
    n_dropped: int
    n_pairs_without_covariates: int
    corr_obs_fitted: float
    unpredicted_value_share: float  # share of observed value in rows the model couldn't predict
    expected: pd.DataFrame  # year, exporter, importer, value, expected


def panel_sql(basket_id: str, exclude: str = "") -> str:
    """Full pair grid × years for one basket, zero-filled, with covariates.

    Expects relations: flows, basket_codes, dim_country, gpairs, grta, universe(year, country_code).
    """
    remap = " ".join(f"WHEN '{k}' THEN '{v}'" for k, v in BACI_TO_GRAVITY_ISO3.items())
    giso = f"CASE c.iso3 {remap} ELSE c.iso3 END" if remap else "c.iso3"
    return f"""
    WITH bf AS (
      SELECT f.year, f.exporter, f.importer, sum(f.value_kusd) AS value
      FROM flows f JOIN basket_codes b USING (product_code)
      WHERE b.basket_id = '{basket_id}' GROUP BY ALL
    ), u AS (
      SELECT u.year, u.country_code, {giso} AS giso
      FROM universe u JOIN dim_country c USING (country_code)
      {exclude}
    ), grid AS (
      SELECT a.year, a.country_code AS exporter, b.country_code AS importer, a.giso AS go, b.giso AS gd
      FROM u a JOIN u b ON a.year = b.year AND a.country_code <> b.country_code
    )
    SELECT g.year, g.exporter, g.importer, coalesce(bf.value, 0) AS value,
           ln(p.dist_km) AS ldist, p.contig, p.comlang_off AS comlang, p.colony, coalesce(r.rta, 0) AS rta,
           p.cov_missing,
           g.exporter || '_' || g.year AS exp_year, g.importer || '_' || g.year AS imp_year,
           least(g.exporter, g.importer) || '_' || greatest(g.exporter, g.importer) AS pair_id,
           p.dist_km IS NULL AS no_cov
    FROM grid g
    LEFT JOIN bf USING (year, exporter, importer)
    LEFT JOIN gpairs p ON p.iso3_o = g.go AND p.iso3_d = g.gd
    LEFT JOIN grta r ON r.iso3_o = g.go AND r.iso3_d = g.gd AND r.year = g.year
    """


def estimate(df: pd.DataFrame, basket_id: str) -> GravityFit:
    """Fit PPML on rows with covariates. Predictions for every row (0 where the model can't predict)."""
    has_cov = ~df["no_cov"]
    est = df.loc[has_cov].reset_index(drop=True)
    fit = pf.fepois(FORMULA, data=est, vcov={"CRV1": "pair_id"})
    pred = np.asarray(fit.predict(newdata=est, type="response"), dtype=float)
    missing = np.isnan(pred)
    pos_total = est.loc[est["value"] > 0, "value"].sum()
    unpredicted = float(est.loc[missing & (est["value"] > 0), "value"].sum() / pos_total) if pos_total else 0.0
    if unpredicted > MAX_UNPREDICTED_VALUE_SHARE:
        raise GravityError(
            f"{basket_id}: {unpredicted:.2%} of observed trade value has no gravity prediction "
            f"(limit {MAX_UNPREDICTED_VALUE_SHARE:.2%}); check covariate coverage"
        )
    # Remaining NaNs are rows whose fixed effects were dropped (all-zero exporter/importer-years).
    est["expected"] = np.where(missing, 0.0, pred)
    tidy = fit.tidy()
    coefs = {
        name: {"estimate": float(tidy.loc[name, "Estimate"]), "se": float(tidy.loc[name, "Std. Error"])}
        for name in COVARIATES
        if name in tidy.index
    }
    pos = est["value"] > 0
    corr = float(np.corrcoef(est.loc[pos, "value"], est.loc[pos, "expected"])[0, 1]) if pos.sum() > 2 else float("nan")
    return GravityFit(
        basket_id=basket_id,
        coefficients=coefs,
        n_obs=int(fit._N),
        n_dropped=int(len(est) - fit._N),
        n_pairs_without_covariates=int((~has_cov).sum()),
        corr_obs_fitted=corr,
        unpredicted_value_share=unpredicted,
        expected=est[["year", "exporter", "importer", "value", "expected"]],
    )


def load_panel(con: duckdb.DuckDBPyConnection, basket_id: str, exclude: str = "") -> pd.DataFrame:
    return con.execute(panel_sql(basket_id, exclude)).df()
