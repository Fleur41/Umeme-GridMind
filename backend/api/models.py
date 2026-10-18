from django.db import models


class GridNode(models.Model):
    KINDS = [(k, k) for k in ("hub", "solar", "wind", "thermal", "battery", "load")]
    id = models.CharField(primary_key=True, max_length=40)
    name = models.CharField(max_length=120)
    kind = models.CharField(max_length=20, choices=KINDS)
    location = models.CharField(max_length=120, blank=True)
    params = models.JSONField(default=dict)  # units documented in gridmind/grid.py

    class Meta:
        ordering = ["id"]


class GridLink(models.Model):
    id = models.CharField(primary_key=True, max_length=40)
    source = models.ForeignKey(GridNode, on_delete=models.CASCADE, related_name="links_out")
    target = models.ForeignKey(GridNode, on_delete=models.CASCADE, related_name="links_in")
    capacity_mw = models.FloatField()

    class Meta:
        ordering = ["id"]


class Scenario(models.Model):
    ROLES = [("predefined", "Predefined"), ("training", "Training"), ("holdout", "Held-out (generated)")]
    key = models.CharField(primary_key=True, max_length=60)
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    role = models.CharField(max_length=20, choices=ROLES)
    params = models.JSONField(default=dict)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["order"]


class RuleVersion(models.Model):
    ORIGINS = [("baseline", "Baseline"), ("adaptation", "Adaptation"), ("rollback", "Rollback")]
    version = models.PositiveIntegerField(unique=True)
    rules = models.JSONField()  # list of gridmind.reasoning.Rule dicts
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="children")
    origin = models.CharField(max_length=20, choices=ORIGINS)
    note = models.TextField(blank=True)
    is_active = models.BooleanField(default=False)
    holdout_score = models.FloatField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["version"]


class SimulationRun(models.Model):
    STATUSES = [("ready", "Ready"), ("running", "Running"), ("complete", "Complete")]
    scenario = models.ForeignKey(Scenario, on_delete=models.PROTECT, related_name="runs")
    rule_version = models.ForeignKey(RuleVersion, on_delete=models.PROTECT, related_name="runs")
    status = models.CharField(max_length=20, choices=STATUSES, default="ready")
    state = models.JSONField(default=dict)  # gridmind.simulator.GridState
    metrics = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-id"]


class Decision(models.Model):
    """One agent decision and its simulated outcome: the decision ledger."""

    run = models.ForeignKey(SimulationRun, on_delete=models.CASCADE, related_name="decisions")
    t = models.PositiveIntegerField()
    hour = models.FloatField()
    facts = models.JSONField()
    agents = models.JSONField()
    reasoning = models.JSONField()  # MeTTa fired / not-fired rules and fact atoms
    resolution = models.JSONField()
    settings = models.JSONField()
    alerts = models.JSONField()
    plan = models.JSONField()
    alternatives = models.JSONField()
    feasibility = models.JSONField()
    expected = models.JSONField()
    outcome = models.JSONField()
    state_before = models.JSONField()
    state_after = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["run_id", "t"]
        constraints = [models.UniqueConstraint(fields=["run", "t"], name="unique_decision_per_step")]


class Adaptation(models.Model):
    STATUSES = [("accepted", "Accepted"), ("rejected", "Rejected"), ("no-candidates", "No candidates")]
    from_version = models.ForeignKey(RuleVersion, on_delete=models.CASCADE, related_name="adaptations")
    to_version = models.OneToOneField(RuleVersion, null=True, blank=True, on_delete=models.SET_NULL,
                                      related_name="created_by")
    status = models.CharField(max_length=20, choices=STATUSES)
    accepted_rule = models.JSONField(null=True, blank=True)
    report = models.JSONField()  # full gridmind.learning.adapt report
    duration_s = models.FloatField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-id"]


class Evaluation(models.Model):
    version_a = models.ForeignKey(RuleVersion, on_delete=models.CASCADE, related_name="+")
    version_b = models.ForeignKey(RuleVersion, on_delete=models.CASCADE, related_name="+")
    scenario_keys = models.JSONField()
    results = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-id"]


class AuditEvent(models.Model):
    kind = models.CharField(max_length=40)
    message = models.TextField()
    payload = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-id"]
