from pathlib import Path

import pytest

from tradegraph.config import ConfigError, load_baskets, load_pipeline

ROOT = Path(__file__).resolve().parents[1]


def write(tmp_path, body: str) -> Path:
    p = tmp_path / "baskets.yaml"
    p.write_text(body)
    return p


HEAD = "hs_revision: HS12\nsource_release: BACI_V202601\nbaskets:\n"


def test_repo_configs_are_valid():
    b = load_baskets(ROOT / "configs/baskets.yaml")
    assert {x.id for x in b.baskets} >= {"integrated_circuits", "control_green_coffee"}
    coffee = next(x for x in b.baskets if x.id == "control_green_coffee")
    assert coffee.codes == ["090111"]  # leading zero preserved
    cfg = load_pipeline(ROOT / "configs/pipeline.yaml")
    assert cfg.baci.year_list[0] == 2012


@pytest.mark.parametrize("code", ["850760", "010121"])  # int; and octal-looking -> int 4177
def test_unquoted_code_is_rejected(tmp_path, code):
    p = write(tmp_path, HEAD + f"  x:\n    label: X\n    codes: [{code}]\n")
    with pytest.raises(ConfigError, match="quoted string"):
        load_baskets(p)


@pytest.mark.parametrize("code", ['"85423"', '"8542310"', '"85423x"'])
def test_bad_code_shape(tmp_path, code):
    p = write(tmp_path, HEAD + f"  chips:\n    label: Chips\n    codes: [{code}]\n")
    with pytest.raises(ConfigError, match="6 digits"):
        load_baskets(p)


def test_duplicate_codes_rejected(tmp_path):
    p = write(tmp_path, HEAD + '  chips:\n    label: Chips\n    codes: ["854231", "854231"]\n')
    with pytest.raises(ConfigError, match="duplicate"):
        load_baskets(p)


def test_bad_basket_id(tmp_path):
    p = write(tmp_path, HEAD + '  Chips-X:\n    label: Chips\n    codes: ["854231"]\n')
    with pytest.raises(ConfigError, match="snake_case"):
        load_baskets(p)


def test_unknown_codes_reported(tmp_path):
    p = write(tmp_path, HEAD + '  chips:\n    label: Chips\n    codes: ["854231", "999998"]\n')
    b = load_baskets(p)
    with pytest.raises(ConfigError, match="chips:999998"):
        b.check_codes_exist({"854231"})


def test_code_may_be_shared_across_baskets(tmp_path):
    p = write(tmp_path, HEAD + '  a:\n    label: A\n    codes: ["854231"]\n  b:\n    label: B\n    codes: ["854231"]\n')
    assert len(load_baskets(p).rows()) == 2
