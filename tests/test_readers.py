"""Tests unitaires des conversions (sans Data Pack)."""

from pipeline.extract_annuaires import looks_like_year_label, read_values, year_from_label
from pipeline.readers import normalize_name, parse_values, split_numbers


def test_thousands_and_decimals():
    assert split_numbers("3 067 940") == [3067940.0]
    assert split_numbers("78,2") == [78.2]
    assert split_numbers("1006") == [1006.0]
    assert split_numbers("ND") is None
    assert split_numbers("Garçons") is None


def test_merged_cells_are_split_on_non_triplets():
    # Deux nombres fusionnés à l'extraction : « 3 067 940 1 532 444 »
    assert split_numbers("164 143 173 046") == [164143173046.0]  # ambigu : lecture gloutonne
    vals, flag = read_values(["279 160", "256 167", "535 327", "164 143 173 046", "337 189", "58,8", "67,6", "63,0"],
                             9, ((0, 1, 2), (3, 4, 5)))
    assert flag == "fusion_resolue"
    assert vals[3:6] == [164143.0, 173046.0, 337189.0]


def test_sum_constraint_flag():
    vals, flag = read_values(["10", "20", "31"], 3, ((0, 1, 2),))
    assert vals == [10.0, 20.0, 31.0]
    assert flag == "incoherence_somme"


def test_parse_values_keeps_missing():
    assert parse_values(["12", "ND", "3,5"]) == [12.0, None, 3.5]


def test_names_are_normalised():
    assert normalize_name("Sud - Ouest") == "SUDOUEST"
    assert normalize_name("Komondjari") == "KOMONDJARI"
    assert normalize_name("Kénédougou") == "KENEDOUGOU"


def test_year_labels():
    assert year_from_label("2023/2024") == "2023-2024"
    assert year_from_label("2022/2022") is None
    assert looks_like_year_label("202122023")
    assert looks_like_year_label("2008/2009 2008/2009")
    assert not looks_like_year_label("BANWA")
