import pytest

from gridmind.reasoning import TemplateLibrary, baseline_rules


@pytest.fixture(scope="session")
def base_rules():
    return baseline_rules()


@pytest.fixture(scope="session")
def library():
    return TemplateLibrary()


@pytest.fixture
def seeded(db):
    from api import services

    services.seed()
