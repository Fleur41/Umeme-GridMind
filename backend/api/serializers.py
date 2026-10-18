from rest_framework import serializers

from .models import (
    Adaptation,
    AuditEvent,
    Decision,
    Evaluation,
    GridLink,
    GridNode,
    RuleVersion,
    Scenario,
    SimulationRun,
)


class GridNodeSerializer(serializers.ModelSerializer):
    class Meta:
        model = GridNode
        fields = ["id", "name", "kind", "location", "params"]
        read_only_fields = ["id", "kind"]

    def validate_params(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("params must be an object")
        current = self.instance.params if self.instance else {}
        for k, v in value.items():
            if k not in current:
                raise serializers.ValidationError(f"unknown parameter '{k}'")
            if not isinstance(v, (int, float)) or isinstance(v, bool) or v < 0:
                raise serializers.ValidationError(f"'{k}' must be a non-negative number")
        merged = {**current, **value}
        for lo, hi in (("soc_min", "soc_max"),):
            if lo in merged and not (0 <= merged[lo] < merged[hi] <= 1):
                raise serializers.ValidationError("require 0 <= soc_min < soc_max <= 1")
        for k in ("charge_efficiency", "discharge_efficiency"):
            if k in merged and not (0 < merged[k] <= 1):
                raise serializers.ValidationError(f"{k} must be in (0, 1]")
        return merged


class GridLinkSerializer(serializers.ModelSerializer):
    capacity_mw = serializers.FloatField(min_value=0.0, max_value=1000.0)

    class Meta:
        model = GridLink
        fields = ["id", "source", "target", "capacity_mw"]
        read_only_fields = ["id", "source", "target"]


class ScenarioSerializer(serializers.ModelSerializer):
    class Meta:
        model = Scenario
        fields = ["key", "name", "description", "role", "params"]


class RuleVersionSerializer(serializers.ModelSerializer):
    created_by_adaptation = serializers.SerializerMethodField()

    class Meta:
        model = RuleVersion
        fields = ["id", "version", "rules", "parent", "origin", "note", "is_active", "holdout_score", "created_at",
                  "created_by_adaptation"]

    def get_created_by_adaptation(self, obj):
        a = getattr(obj, "created_by", None)
        return a.id if a else None


class RunSerializer(serializers.ModelSerializer):
    scenario = ScenarioSerializer(read_only=True)
    version = serializers.IntegerField(source="rule_version.version", read_only=True)
    t = serializers.IntegerField(source="state.t", read_only=True)

    class Meta:
        model = SimulationRun
        fields = ["id", "scenario", "version", "status", "t", "state", "metrics", "created_at"]


class RunCreateSerializer(serializers.Serializer):
    scenario = serializers.SlugField()
    version = serializers.IntegerField(required=False, min_value=1)


class StepSerializer(serializers.Serializer):
    steps = serializers.IntegerField(required=False, min_value=1, max_value=48, default=1)


class DecisionSummarySerializer(serializers.ModelSerializer):
    fired = serializers.SerializerMethodField()

    class Meta:
        model = Decision
        fields = ["id", "run", "t", "hour", "alerts", "plan", "outcome", "fired"]

    def get_fired(self, obj):
        return [f["rule"] for f in obj.reasoning.get("fired", [])]


class DecisionSerializer(serializers.ModelSerializer):
    version = serializers.IntegerField(source="run.rule_version.version", read_only=True)
    scenario = serializers.CharField(source="run.scenario.key", read_only=True)

    class Meta:
        model = Decision
        fields = "__all__"


class AdaptationSummarySerializer(serializers.ModelSerializer):
    from_version = serializers.IntegerField(source="from_version.version")
    to_version = serializers.IntegerField(source="to_version.version", allow_null=True)
    patterns = serializers.SerializerMethodField()
    candidates = serializers.SerializerMethodField()

    class Meta:
        model = Adaptation
        fields = ["id", "from_version", "to_version", "status", "accepted_rule", "duration_s", "created_at",
                  "patterns", "candidates"]

    def get_patterns(self, obj):
        return [{k: p[k] for k in ("pattern", "occurrences")} for p in obj.report["diagnosis"]["patterns"]]

    def get_candidates(self, obj):
        return [{"name": c["rule"]["name"], "status": c["status"]} for c in obj.report["candidates"]]


class AdaptationSerializer(AdaptationSummarySerializer):
    class Meta(AdaptationSummarySerializer.Meta):
        fields = AdaptationSummarySerializer.Meta.fields + ["report"]


class EvaluationSerializer(serializers.ModelSerializer):
    version_a = serializers.IntegerField(source="version_a.version")
    version_b = serializers.IntegerField(source="version_b.version")

    class Meta:
        model = Evaluation
        fields = ["id", "version_a", "version_b", "scenario_keys", "results", "created_at"]


class EvaluationCreateSerializer(serializers.Serializer):
    version_a = serializers.IntegerField(min_value=1)
    version_b = serializers.IntegerField(min_value=1)
    scenario_set = serializers.ChoiceField(choices=["holdout", "predefined", "all"], default="holdout")


class CompareSerializer(serializers.Serializer):
    scenario = serializers.SlugField()
    version_a = serializers.IntegerField(min_value=1)
    version_b = serializers.IntegerField(min_value=1)


class ReasonSerializer(serializers.Serializer):
    facts = serializers.DictField(child=serializers.FloatField())
    version = serializers.IntegerField(required=False, min_value=1)

    def validate_facts(self, value):
        import re

        for k in value:
            if not re.fullmatch(r"[a-z][a-z0-9-]{0,40}", k):
                raise serializers.ValidationError(f"invalid fact name '{k}'")
        return value


class AuditEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditEvent
        fields = ["id", "kind", "message", "payload", "created_at"]
