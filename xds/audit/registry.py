"""The audit rule registry: `@rule` registers a rule function, `xds rules` lists them.

Each rule is a small function `(slide: MeasuredSlide, t: Thresholds) -> Iterator[Hit]` whose
docstring states the design principle. The engine turns each `Hit` into a `Finding`, filling in
the rule id, family, principle and slide.

Importing this module imports every rule module (cheap: numpy only, no cv2).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Iterator

from ..models import Edit
from .geometry import R

Severity = str  # "error" | "warn" | "info"


@dataclass
class Hit:
    """One finding as a rule reports it; the engine adds rule, family, principle and slide."""

    message: str
    fix: str
    nodes: list[str] = field(default_factory=list)
    region: R | None = None
    measured: dict[str, Any] = field(default_factory=dict)
    expected: dict[str, Any] = field(default_factory=dict)
    severity: Severity | None = None  # required for rules with tiers ("warn/error")
    # The fix as field edits, when the fix is a concrete value (design-rules §6.1); else empty.
    edits: list[Edit] = field(default_factory=list)


@dataclass
class RuleSpec:
    id: str
    family: str
    severity: str  # "error", "warn", "info", or tiers like "warn/error"
    fn: Callable[..., Iterator[Hit]]
    principle: str
    thresholds: tuple[str, ...]


RULES: dict[str, RuleSpec] = {}


def _principle(doc: str | None) -> str:
    first = (doc or "").strip().split("\n\n")[0]
    return " ".join(first.split())


def rule(rule_id: str, *, family: str, severity: str, thresholds: tuple[str, ...] = ()):
    """Register an audit rule. The docstring's first paragraph is its principle."""

    def wrap(fn: Callable[..., Iterator[Hit]]) -> Callable[..., Iterator[Hit]]:
        if rule_id in RULES:
            raise ValueError(f"duplicate rule {rule_id}")
        RULES[rule_id] = RuleSpec(rule_id, family, severity, fn, _principle(fn.__doc__), thresholds)
        return fn

    return wrap


def rule_names() -> set[str]:
    return set(RULES)


def threshold_keys() -> set[str]:
    from .thresholds import KEY_NAMES

    return set(KEY_NAMES)


def catalog(guide: Any, overrides: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """Every rule with its family, severity, principle and current thresholds (`xds rules`)."""
    from .thresholds import Thresholds, describe

    t = Thresholds(guide, overrides)
    return [
        {
            "rule": spec.id,
            "family": spec.family,
            "severity": spec.severity,
            "principle": spec.principle,
            "thresholds": [describe(k, t[k]) for k in spec.thresholds],
        }
        for spec in RULES.values()
    ]


# Register every rule (each module's decorators run on import).
from .rules import collision, composition, contrast, spacing, subject, typography  # noqa: E402,F401
