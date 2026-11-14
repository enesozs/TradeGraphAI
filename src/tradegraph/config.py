"""Load and validate the pipeline and basket configuration.

Baskets are pure configuration: edit ``configs/baskets.yaml`` and rebuild the marts.
Validation is strict so that a typo fails loudly instead of silently producing wrong results.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field, field_validator, model_validator

HS6 = re.compile(r"^\d{6}$")
BASKET_ID = re.compile(r"^[a-z][a-z0-9_]*$")


class ConfigError(ValueError):
    """Raised when a configuration file is invalid."""


class Basket(BaseModel):
    id: str
    label: str
    short_label: str | None = Field(default=None, max_length=16)
    rationale: str = ""
    codes: list[str] = Field(min_length=1)
    caveats: list[str] = []
    value_only: bool = False  # tonnes are not a meaningful basis (e.g. integrated circuits)

    @field_validator("id")
    @classmethod
    def _id(cls, v: str) -> str:
        if not BASKET_ID.match(v):
            raise ValueError(f"basket id {v!r} must be lowercase snake_case")
        return v

    @field_validator("codes", mode="before")
    @classmethod
    def _codes(cls, v: Any) -> Any:
        if not isinstance(v, list):
            raise ValueError("codes must be a list")
        for c in v:
            if not isinstance(c, str):
                raise ValueError(
                    f'product code {c!r} must be a quoted string, e.g. "090111" (unquoted numbers lose leading zeros)'
                )
            if not HS6.match(c):
                raise ValueError(f"product code {c!r} must be exactly 6 digits")
        if len(set(v)) != len(v):
            raise ValueError("duplicate product codes in basket")
        return v


class BasketConfig(BaseModel):
    hs_revision: str
    source_release: str
    baskets: list[Basket]

    @model_validator(mode="after")
    def _unique_ids(self) -> BasketConfig:
        ids = [b.id for b in self.baskets]
        if len(set(ids)) != len(ids):
            raise ValueError("duplicate basket ids")
        return self

    def rows(self) -> list[tuple[str, str]]:
        """(basket_id, product_code) pairs, the form the marts join on."""
        return [(b.id, c) for b in self.baskets for c in b.codes]

    def check_codes_exist(self, known_codes: set[str]) -> None:
        """Fail if any basket code is not in the source's product list."""
        missing = {(b.id, c) for b, c in ((b, c) for b in self.baskets for c in b.codes) if c not in known_codes}
        if missing:
            detail = ", ".join(f"{b}:{c}" for b, c in sorted(missing))
            raise ConfigError(f"codes not in {self.hs_revision} product list: {detail}")


class BaciSettings(BaseModel):
    release: str
    hs_revision: str
    url_template: str
    years: tuple[int, int]
    provisional_years: list[int] = []

    @property
    def url(self) -> str:
        return self.url_template.format(hs=self.hs_revision, release=self.release)

    @property
    def year_list(self) -> list[int]:
        return list(range(self.years[0], self.years[1] + 1))


class WdiSettings(BaseModel):
    indicator: str
    years: tuple[int, int]


class GravitySettings(BaseModel):
    release: str = "202211"
    url_template: str = "https://www.cepii.fr/DATA_DOWNLOAD/gravity/data/Gravity_csv_V{release}.zip"
    rta_carry_forward: bool = True
    sensitivity_drop_smallest_share: float = Field(default=0.10, ge=0, lt=0.5)
    community_resolution: float = Field(default=1.5, gt=0)

    @property
    def url(self) -> str:
        return self.url_template.format(release=self.release)


class MoversSettings(BaseModel):
    start_years: tuple[int, int] = (2012, 2014)
    end_years: tuple[int, int] = (2021, 2023)
    min_imports_kusd: float = 100_000

    @model_validator(mode="after")
    def _ordered(self) -> MoversSettings:
        (a, b), (c, d) = self.start_years, self.end_years
        if not (a <= b < c <= d):
            raise ValueError("movers windows must be ordered and non-overlapping: start <= end, start window first")
        return self


class ForecastSettings(BaseModel):
    validation_target_years: tuple[int, int] = (2017, 2022)
    holdout_target_year: int = 2023
    seed: int = 0

    @model_validator(mode="after")
    def _holdout_after_validation(self) -> ForecastSettings:
        a, b = self.validation_target_years
        if not (a <= b < self.holdout_target_year):
            raise ValueError("validation target years must precede the holdout year")
        return self

    @property
    def validation_years(self) -> list[int]:
        return list(range(self.validation_target_years[0], self.validation_target_years[1] + 1))


class ScenarioSettings(BaseModel):
    year: int = 2023
    top_suppliers: int = Field(default=5, ge=1)
    shortfalls: list[float] = [0.25, 0.5, 0.75, 1.0]
    monte_carlo_shortfalls: list[float] = [0.5, 1.0]
    monte_carlo_draws: int = Field(default=100, ge=10)
    max_alternatives: int = Field(default=40, ge=1)


class ComextSettings(BaseModel):
    dataset: str = "DS-045409"
    api: str = "https://ec.europa.eu/eurostat/api/comext/dissemination/sdmx/2.1/data"
    reporters: list[str] = ["EU27_2020", "DE", "FR", "IT", "NL", "ES", "PL"]
    start_year: int = 2023
    pause_seconds: float = Field(default=1.0, ge=0)


class SeaSettings(BaseModel):
    ports_per_country: int = Field(default=3, ge=1)
    secondary_port_penalty: float = Field(default=0.03, ge=0)
    max_snap_km: float = Field(default=400, gt=0)
    detour_ratio: float = Field(default=2.0, gt=1)
    detour_max_km: float = Field(default=3000, gt=0)
    closure_year: int = 2023
    closures: list[str] = ["suez", "bab_el_mandeb", "hormuz", "malacca", "panama", "gibraltar", "turkish_straits",
                           "cape_of_good_hope"]  # fmt: skip


class PipelineConfig(BaseModel):
    baci: BaciSettings
    wdi: WdiSettings
    movers: MoversSettings = MoversSettings()
    gravity: GravitySettings = GravitySettings()
    forecast: ForecastSettings = ForecastSettings()
    scenarios: ScenarioSettings = ScenarioSettings()
    comext: ComextSettings = ComextSettings()
    sea: SeaSettings = SeaSettings()
    paths: dict[str, str]

    @property
    def data_dir(self) -> Path:
        return Path(self.paths.get("data_dir", "data"))


def _read_yaml(path: Path) -> dict[str, Any]:
    try:
        return yaml.safe_load(path.read_text()) or {}
    except FileNotFoundError as e:
        raise ConfigError(f"missing config file {path}") from e


def load_baskets(path: Path | str = "configs/baskets.yaml") -> BasketConfig:
    raw = _read_yaml(Path(path))
    baskets = [{"id": k, **v} for k, v in (raw.get("baskets") or {}).items()]
    try:
        return BasketConfig(
            hs_revision=raw.get("hs_revision", ""),
            source_release=raw.get("source_release", ""),
            baskets=baskets,
        )
    except ValueError as e:
        raise ConfigError(f"invalid basket config {path}: {e}") from e


def load_pipeline(path: Path | str = "configs/pipeline.yaml") -> PipelineConfig:
    try:
        return PipelineConfig(**_read_yaml(Path(path)))
    except ValueError as e:
        raise ConfigError(f"invalid pipeline config {path}: {e}") from e
