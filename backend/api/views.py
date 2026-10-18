from hyperon import MeTTa
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action, api_view
from rest_framework.response import Response

from gridmind.reasoning import METTA_DIR, TemplateLibrary
from gridmind.runner import WEIGHTS

from . import services
from .errors import ApiError
from .models import (  # noqa: E501
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
from .serializers import (
    AdaptationSerializer,
    AdaptationSummarySerializer,
    AuditEventSerializer,
    CompareSerializer,
    DecisionSerializer,
    DecisionSummarySerializer,
    EvaluationCreateSerializer,
    EvaluationSerializer,
    GridLinkSerializer,
    GridNodeSerializer,
    ReasonSerializer,
    RuleVersionSerializer,
    RunCreateSerializer,
    RunSerializer,
    ScenarioSerializer,
    StepSerializer,
)


def _version(number) -> RuleVersion:
    v = RuleVersion.objects.filter(version=number).first()
    if v is None:
        raise ApiError(f"Unknown rule version {number}", 404, "not_found")
    return v


@api_view(["GET"])
def health(request):
    try:
        result = str(MeTTa().run("!(+ 1 2)")[0][0])
        metta = {"ok": result == "3", "probe": "!(+ 1 2)", "result": result}
    except Exception as exc:  # pragma: no cover - reported, not raised
        metta = {"ok": False, "error": type(exc).__name__}
    seeded = RuleVersion.objects.exists()
    return Response({"status": "ok" if metta["ok"] and seeded else "degraded", "metta": metta, "seeded": seeded,
                     "mode": "simulation", "disclaimer": "Simulated data only. Not connected to any real grid."})


@api_view(["GET"])
def overview(request):
    version = services.active_version()
    latest = Adaptation.objects.first()
    run = SimulationRun.objects.filter(status__in=["running", "complete"]).first()
    last = run.decisions.order_by("-t").first() if run else None
    return Response({
        "active_version": version.version,
        "rule_count": len(version.rules),
        "versions": RuleVersion.objects.count(),
        "adaptations": {"accepted": Adaptation.objects.filter(status="accepted").count(),
                        "rejected": Adaptation.objects.exclude(status="accepted").count()},
        "latest_adaptation": AdaptationSummarySerializer(latest).data if latest else None,
        "latest_run": RunSerializer(run).data if run else None,
        "latest_decision": DecisionSummarySerializer(last).data if last else None,
        "recent_events": AuditEventSerializer(AuditEvent.objects.all()[:8], many=True).data,
    })


@api_view(["GET"])
def grid(request):
    return Response({"nodes": GridNodeSerializer(GridNode.objects.all(), many=True).data,
                     "links": GridLinkSerializer(GridLink.objects.all(), many=True).data,
                     "units": {"power": "MW", "energy": "MWh", "step_hours": 0.5}})


class GridNodeViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.UpdateModelMixin,
                      viewsets.GenericViewSet):
    queryset = GridNode.objects.all()
    serializer_class = GridNodeSerializer
    pagination_class = None
    http_method_names = ["get", "patch"]

    def perform_update(self, serializer):
        node = serializer.save()
        services.audit("grid.node.updated", f"{node.name} parameters changed", node=node.id, params=node.params)


class GridLinkViewSet(mixins.ListModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    queryset = GridLink.objects.all()
    serializer_class = GridLinkSerializer
    pagination_class = None
    http_method_names = ["get", "patch"]

    def perform_update(self, serializer):
        link = serializer.save()
        services.audit("grid.link.updated", f"{link.id} capacity set to {link.capacity_mw} MW", link=link.id)


class ScenarioViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Scenario.objects.all()
    serializer_class = ScenarioSerializer
    pagination_class = None


class SimulationViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = SimulationRun.objects.select_related("scenario", "rule_version")
    serializer_class = RunSerializer

    def create(self, request):
        s = RunCreateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        run = services.create_run(s.validated_data["scenario"], s.validated_data.get("version"))
        return Response(RunSerializer(run).data, status=status.HTTP_201_CREATED)

    def retrieve(self, request, pk=None):
        run = self.get_object()
        data = RunSerializer(run).data
        data["series"] = [d.outcome for d in run.decisions.order_by("t")]
        data["metrics"] = run.metrics or services.partial_metrics(run)
        return Response(data)

    @action(detail=True, methods=["post"])
    def step(self, request, pk=None):
        s = StepSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        run = self.get_object()
        created = services.advance_run(run, s.validated_data["steps"])
        run.refresh_from_db()
        data = RunSerializer(run).data
        data["new_decisions"] = DecisionSummarySerializer(
            Decision.objects.filter(run=run, t__in=[d.t for d in created]), many=True).data
        data["metrics"] = run.metrics or services.partial_metrics(run)
        return Response(data)

    @action(detail=True, methods=["post"])
    def reset(self, request, pk=None):
        return Response(RunSerializer(services.reset_run(self.get_object())).data)

    @action(detail=True, methods=["get"])
    def metrics(self, request, pk=None):
        run = self.get_object()
        return Response({"run": run.id, "complete": run.status == "complete", "weights": WEIGHTS,
                         "metrics": run.metrics or services.partial_metrics(run)})


class DecisionViewSet(viewsets.ReadOnlyModelViewSet):
    def get_queryset(self):
        qs = Decision.objects.select_related("run__rule_version", "run__scenario")
        if run := self.request.query_params.get("run"):
            qs = qs.filter(run_id=run)
        if self.request.query_params.get("alerts") == "1":
            qs = qs.exclude(alerts=[])
        return qs

    def get_serializer_class(self):
        return DecisionSerializer if self.action == "retrieve" else DecisionSummarySerializer


@api_view(["POST"])
def reason(request):
    s = ReasonSerializer(data=request.data)
    s.is_valid(raise_exception=True)
    version = _version(s.validated_data["version"]) if s.validated_data.get("version") else None
    return Response(services.reason_about(s.validated_data["facts"], version))


@api_view(["GET"])
def rules(request):
    v = services.active_version()
    lib = TemplateLibrary()
    templates = [{"template": n, "options": lib.options(n)} for n in lib.names()]
    sources = {name: (METTA_DIR / name).read_text() for name in ("core.metta", "baseline.metta", "templates.metta",
                                                               "diagnosis.metta")}
    return Response({"version": RuleVersionSerializer(v).data, "templates": templates, "metta_sources": sources})


class RuleVersionViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = RuleVersion.objects.all()
    serializer_class = RuleVersionSerializer
    pagination_class = None
    lookup_field = "version"

    @action(detail=True, methods=["get"])
    def diff(self, request, version=None):
        new = self.get_object()
        against = request.query_params.get("against")
        old = _version(against) if against else new.parent
        return Response(services.rule_diff(old, new))

    @action(detail=True, methods=["post"])
    def rollback(self, request, version=None):
        new = services.rollback_to(self.get_object())
        return Response(RuleVersionSerializer(new).data, status=status.HTTP_201_CREATED)


class AdaptationViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Adaptation.objects.select_related("from_version", "to_version")
    pagination_class = None

    def get_serializer_class(self):
        return AdaptationSerializer if self.action == "retrieve" else AdaptationSummarySerializer

    def create(self, request):
        adaptation = services.run_adaptation()
        return Response(AdaptationSerializer(adaptation).data, status=status.HTTP_201_CREATED)


class EvaluationViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Evaluation.objects.select_related("version_a", "version_b")
    serializer_class = EvaluationSerializer

    def create(self, request):
        s = EvaluationCreateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        roles = {"holdout": ("holdout",), "predefined": ("predefined", "training"),
                 "all": ("holdout", "predefined", "training")}[s.validated_data["scenario_set"]]
        ev = services.evaluate(_version(s.validated_data["version_a"]), _version(s.validated_data["version_b"]), roles)
        return Response(EvaluationSerializer(ev).data, status=status.HTTP_201_CREATED)


@api_view(["POST"])
def compare(request):
    s = CompareSerializer(data=request.data)
    s.is_valid(raise_exception=True)
    d = s.validated_data
    return Response(services.compare_on_scenario(d["scenario"], _version(d["version_a"]), _version(d["version_b"])))


class AuditViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = AuditEvent.objects.all()
    serializer_class = AuditEventSerializer


@api_view(["POST"])
def demo_reset(request):
    services.seed(reset=True)
    services.audit("demo.reset", "Demo reset: all runs, versions and adaptations cleared; baseline v1 restored")
    return Response({"ok": True, "active_version": services.active_version().version})

