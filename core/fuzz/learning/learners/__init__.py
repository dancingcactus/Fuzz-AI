"""The learners: each a module here with a LEARNER and a learn(core). Adding one is adding a file.

learn(core) returns the lessons it wants now, each {key, kind, rule, status, how, example?, case_id?}, keys
starting with LEARNER.prefix. learning.run() adds what's new, retires what it no longer wants (unless you
turned it off) and restores what comes back. Learners read, never write.
"""

import importlib
import pkgutil
from dataclasses import dataclass


@dataclass(frozen=True)
class Learner:
    name: str
    surface: str        # where its lessons are read: extract
    prefix: str         # every key it makes starts with this
    learn: object = None


def _discover():
    out = []
    for m in sorted(pkgutil.iter_modules(__path__), key=lambda m: m.name):
        mod = importlib.import_module(f"{__name__}.{m.name}")
        spec = getattr(mod, "LEARNER", None)
        if spec is not None:
            out.append(Learner(spec.name, spec.surface, spec.prefix, mod.learn))
    return out


LEARNERS = _discover()
