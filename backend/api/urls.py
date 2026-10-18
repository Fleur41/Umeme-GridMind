from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter(trailing_slash=True)
router.register("grid/nodes", views.GridNodeViewSet, basename="node")
router.register("grid/links", views.GridLinkViewSet, basename="link")
router.register("scenarios", views.ScenarioViewSet, basename="scenario")
router.register("simulations", views.SimulationViewSet, basename="simulation")
router.register("decisions", views.DecisionViewSet, basename="decision")
router.register("agent/rules/versions", views.RuleVersionViewSet, basename="ruleversion")
router.register("agent/adaptations", views.AdaptationViewSet, basename="adaptation")
router.register("evaluations", views.EvaluationViewSet, basename="evaluation")
router.register("audit", views.AuditViewSet, basename="audit")

urlpatterns = [
    path("health/", views.health),
    path("overview/", views.overview),
    path("grid/", views.grid),
    path("agent/reason/", views.reason),
    path("agent/rules/", views.rules),
    path("agent/adapt/", views.AdaptationViewSet.as_view({"post": "create"})),
    path("compare/", views.compare),
    path("demo/reset/", views.demo_reset),
] + router.urls
