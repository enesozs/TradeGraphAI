"""Forecast models for log1p(next-year value). Baselines first; every model maps a feature frame to predictions."""

from __future__ import annotations

from collections.abc import Callable

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import RidgeCV
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from tradegraph.forecast.features import BASE_FEATURES, GRAPH_FEATURES

Model = Callable[[pd.DataFrame, pd.Series, pd.DataFrame, int], np.ndarray]


def persistence(train: pd.DataFrame, y: pd.Series, test: pd.DataFrame, seed: int) -> np.ndarray:
    return test["lv0"].to_numpy()


def mean3(train: pd.DataFrame, y: pd.Series, test: pd.DataFrame, seed: int) -> np.ndarray:
    return test["mean3"].to_numpy()


def gravity(train: pd.DataFrame, y: pd.Series, test: pd.DataFrame, seed: int) -> np.ndarray:
    """Gravity-expected value in year t (fit on data <= t). Falls back to persistence if unavailable."""
    return np.where(test["lgrav"].notna(), test["lgrav"], test["lv0"])


def ridge(train: pd.DataFrame, y: pd.Series, test: pd.DataFrame, seed: int) -> np.ndarray:
    pre = ColumnTransformer(
        [
            ("num", make_pipeline(SimpleImputer(strategy="median"), StandardScaler()), BASE_FEATURES),
            ("basket", OneHotEncoder(handle_unknown="ignore"), ["basket_id"]),
        ]
    )
    m = make_pipeline(pre, RidgeCV(alphas=np.logspace(-3, 3, 13)))
    m.fit(train, y)
    return m.predict(test)


def _delta(inner: Model) -> Model:
    """Predict the change from last year (log1p(next) - lv0) and add it back: persistence plus learned corrections."""

    def fit_predict(train: pd.DataFrame, y: pd.Series, test: pd.DataFrame, seed: int) -> np.ndarray:
        return test["lv0"].to_numpy() + inner(train, y - train["lv0"], test, seed)

    return fit_predict


def _hgb(features: list[str], value_weighted: bool = False) -> Model:
    """Gradient boosting. ``value_weighted`` weights each training link by its value in year t
    (known at forecast time), so large links count in training as much as in the value-weighted metric."""

    def fit_predict(train: pd.DataFrame, y: pd.Series, test: pd.DataFrame, seed: int) -> np.ndarray:
        cols = [*features, "basket_id"]
        x_tr, x_te = train[cols].copy(), test[cols].copy()
        cats = pd.Categorical(train["basket_id"]).categories
        for x in (x_tr, x_te):
            x["basket_id"] = pd.Categorical(x["basket_id"], categories=cats)
        m = HistGradientBoostingRegressor(
            max_iter=300, learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=50,
            l2_regularization=1.0, categorical_features=["basket_id"], random_state=seed,
        )  # fmt: skip
        w = train["value"].to_numpy() / train["value"].mean() if value_weighted else None
        m.fit(x_tr, y, sample_weight=w)
        return m.predict(x_te)

    return fit_predict


MODELS: dict[str, Model] = {
    "persistence": persistence,
    "mean3": mean3,
    "gravity": gravity,
    "ridge": ridge,
    "gbm": _hgb(BASE_FEATURES),
    "gbm_graph": _hgb(BASE_FEATURES + GRAPH_FEATURES),
    # Added after the 2023 holdout was seen (ADR-007): its 2023 result is post-hoc, not a clean holdout.
    "gbm_weighted": _hgb(BASE_FEATURES + GRAPH_FEATURES, value_weighted=True),
    "gbm_delta": _delta(_hgb(BASE_FEATURES + GRAPH_FEATURES)),
    "gbm_delta_weighted": _delta(_hgb(BASE_FEATURES + GRAPH_FEATURES, value_weighted=True)),
}
POST_HOC_MODELS = {"gbm_weighted", "gbm_delta", "gbm_delta_weighted"}
