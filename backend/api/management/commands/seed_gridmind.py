from django.core.management.base import BaseCommand

from api import services


class Command(BaseCommand):
    help = "Load the sample grid, scenario library and baseline MeTTa policy (idempotent)."

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true", help="Delete all runs, versions and adaptations first")

    def handle(self, *args, reset=False, **options):
        services.seed(reset=reset)
        v = services.active_version()
        self.stdout.write(self.style.SUCCESS(f"Seeded. Active rule version: v{v.version} ({len(v.rules)} rules)"))
