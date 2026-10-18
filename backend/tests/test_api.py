"""REST API behaviour, validation, persistence and audit trail."""

import pytest
from rest_framework.test import APIClient

from api.models import AuditEvent, Decision, RuleVersion


@pytest.fixture
def client(seeded):
    return APIClient()


def test_health_reports_metta(client):
    body = client.get("/api/health/").json()
    assert body["metta"]["ok"] and body["seeded"] and body["mode"] == "simulation"


def test_grid_and_scenarios(client):
    grid = client.get("/api/grid/").json()
    assert {n["kind"] for n in grid["nodes"]} >= {"solar", "wind", "thermal", "battery", "load"}
    roles = {s["role"] for s in client.get("/api/scenarios/").json()}
    assert roles == {"predefined", "training", "holdout"}


def test_node_param_validation(client):
    r = client.patch("/api/grid/nodes/battery/", {"params": {"soc_min": 0.9, "soc_max": 0.5}}, format="json")
    assert r.status_code == 400 and r.json()["error"]["details"]
    r = client.patch("/api/grid/nodes/battery/", {"params": {"unknown": 1}}, format="json")
    assert r.status_code == 400
    r = client.patch("/api/grid/nodes/battery/", {"params": {"power_mw": 40}}, format="json")
    assert r.status_code == 200 and r.json()["params"]["power_mw"] == 40


def test_simulation_lifecycle_records_ledger(client):
    run = client.post("/api/simulations/", {"scenario": "compound"}, format="json").json()
    step = client.post(f"/api/simulations/{run['id']}/step/", {"steps": 4}, format="json").json()
    assert step["t"] == 4 and step["status"] == "running" and len(step["new_decisions"]) == 4
    d = Decision.objects.filter(run_id=run["id"]).first()
    detail = client.get(f"/api/decisions/{d.id}/").json()
    for key in ("facts", "reasoning", "resolution", "plan", "feasibility", "expected", "outcome", "agents"):
        assert key in detail
    done = client.post(f"/api/simulations/{run['id']}/step/", {"steps": 48}, format="json").json()
    assert done["status"] == "complete" and done["metrics"]["steps"] == 48
    assert client.post(f"/api/simulations/{run['id']}/step/", {}, format="json").status_code == 409
    reset = client.post(f"/api/simulations/{run['id']}/reset/").json()
    assert reset["status"] == "ready" and not Decision.objects.filter(run_id=run["id"]).exists()


def test_replay_is_reproducible(client):
    scores = []
    for _ in range(2):
        run = client.post("/api/simulations/", {"scenario": "solar-drop"}, format="json").json()
        scores.append(client.post(f"/api/simulations/{run['id']}/step/", {"steps": 48}, format="json")
                      .json()["metrics"]["score"])
    assert scores[0] == scores[1]


def test_input_validation(client):
    assert client.post("/api/simulations/", {"scenario": "nope"}, format="json").status_code == 404
    assert client.post("/api/simulations/", {}, format="json").status_code == 400
    r = client.post("/api/agent/reason/", {"facts": {"x) (evil": 1}}, format="json")
    assert r.status_code == 400
    assert client.get("/api/agent/rules/versions/99/").status_code == 404


def test_reason_endpoint_uses_active_policy(client):
    r = client.post("/api/agent/reason/", {"facts": {"deficit": 3, "reserve-margin": 1}}, format="json").json()
    assert {f["rule"] for f in r["fired"]} == {"cover-deficit-battery-first", "reserve-alert"}


@pytest.mark.django_db(transaction=True)
def test_adapt_diff_rollback_and_audit(client):
    a = client.post("/api/agent/adapt/").json()
    assert a["status"] == "accepted" and a["from_version"] == 1 and a["to_version"] == 2
    diff = client.get("/api/agent/rules/versions/2/diff/").json()
    assert [r["name"] for r in diff["added"]] == [a["accepted_rule"]["name"]]
    assert RuleVersion.objects.get(is_active=True).version == 2

    rb = client.post("/api/agent/rules/versions/1/rollback/").json()
    assert rb["version"] == 3 and rb["origin"] == "rollback" and rb["is_active"]
    assert client.get("/api/agent/rules/versions/3/diff/?against=2").json()["removed"]
    assert client.post("/api/agent/rules/versions/3/rollback/").status_code == 409
    kinds = set(AuditEvent.objects.values_list("kind", flat=True))
    assert {"adaptation.accepted", "rules.rollback"} <= kinds

    ev = client.post("/api/evaluations/", {"version_a": 1, "version_b": 2}, format="json").json()
    assert len(ev["scenario_keys"]) == 8
    assert ev["results"]["b"]["aggregate"]["score"] < ev["results"]["a"]["aggregate"]["score"]

    assert client.post("/api/demo/reset/").json()["active_version"] == 1
    assert RuleVersion.objects.count() == 1


def test_write_token_enforced_when_configured(client, settings):
    settings.GRIDMIND_WRITE_TOKEN = "secret"
    assert client.get("/api/scenarios/").status_code == 200
    assert client.post("/api/simulations/", {"scenario": "normal"}, format="json").status_code == 403
    r = client.post("/api/simulations/", {"scenario": "normal"}, format="json", HTTP_X_GRIDMIND_TOKEN="secret")
    assert r.status_code == 201
