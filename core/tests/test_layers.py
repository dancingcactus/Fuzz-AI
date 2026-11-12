"""The core's layers, checked from its imports (top-level and inside functions alike):

  foundation  config, db, states, events: import nothing above them
  domain      tasks, cards, drafts, groups, matching, memory...: still a cycle, which may only shrink
  top         actions, followups and the interfaces: nothing below imports them

See docs/architecture-review.md, item 2.
"""

import ast
import os
import unittest

PKG = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fuzz")

FOUNDATION = {"config", "db", "states", "events"}
TOP = {"actions", "followups", "http_api", "cli", "mcp_server", "runner", "__main__", "roles.scripted"}

# The modules in an import cycle today. A module joining one fails the test; when one leaves (a cycle broken),
# take it out here so it can't come back.
CYCLE_BASELINE = {
    "booking", "cards", "deliverables", "doctor", "drafts", "engine", "files", "focus", "groups", "matching",
    "matching.dupes", "matching.entities", "matching.matcher", "matching.who", "memory.briefs", "memory.extract",
    "memory.facts", "memory.knowledge", "memory.mcards", "missed", "onboarding", "outputs", "people", "review",
    "scheduler", "sessions", "setup", "tasks",
}


def modules():
    out = {}
    for d, _, files in os.walk(PKG):
        if "__pycache__" in d:
            continue
        for f in files:
            if f.endswith(".py"):
                rel = os.path.relpath(os.path.join(d, f), PKG)[:-3].replace(os.sep, ".")
                out[rel[:-len(".__init__")] if rel.endswith(".__init__") else rel] = os.path.join(d, f)
    return out


def imports(mods):
    """module -> the package modules it imports, anywhere in the file."""
    graph = {}
    for name, path in mods.items():
        is_pkg = path.endswith("__init__.py")
        here = name.split(".") if is_pkg else name.split(".")[:-1]
        if name == "__init__":
            here = []
        deps = set()
        for node in ast.walk(ast.parse(open(path).read())):
            if not (isinstance(node, ast.ImportFrom) and node.level):
                continue
            base = here[:len(here) - (node.level - 1)]
            mod = base + (node.module.split(".") if node.module else [])
            if node.module and ".".join(mod) in mods:
                deps.add(".".join(mod))
            for a in node.names:
                sub = ".".join(mod + [a.name])
                if sub in mods:
                    deps.add(sub)
        deps.discard(name)
        graph[name] = deps
    return graph


def in_cycles(graph):
    """The modules in a strongly connected group of two or more (Tarjan)."""
    index, low, stack, on, out, n = {}, {}, [], set(), set(), [0]

    def visit(v):
        index[v] = low[v] = n[0]
        n[0] += 1
        stack.append(v)
        on.add(v)
        for w in graph[v]:
            if w not in index:
                visit(w)
                low[v] = min(low[v], low[w])
            elif w in on:
                low[v] = min(low[v], index[w])
        if low[v] == index[v]:
            group = []
            while True:
                w = stack.pop()
                on.discard(w)
                group.append(w)
                if w == v:
                    break
            if len(group) > 1:
                out.update(group)

    for v in graph:
        if v not in index:
            visit(v)
    return out


class Layers(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.graph = imports(modules())

    def test_the_foundation_imports_nothing_above_it(self):
        for m in FOUNDATION:
            self.assertLessEqual(self.graph[m], FOUNDATION, f"{m} imports {sorted(self.graph[m] - FOUNDATION)}")

    def test_nothing_below_imports_the_top(self):
        for m, deps in self.graph.items():
            if m not in TOP:
                self.assertFalse(deps & TOP, f"{m} imports {sorted(deps & TOP)}, which sit above it")

    def test_no_module_joins_an_import_cycle(self):
        now = in_cycles(self.graph)
        self.assertFalse(now - CYCLE_BASELINE, f"joined an import cycle: {sorted(now - CYCLE_BASELINE)}")

    def test_a_module_that_left_the_cycle_is_taken_off_the_list(self):
        now = in_cycles(self.graph)
        self.assertFalse(CYCLE_BASELINE - now,
                         f"no longer in a cycle, take them out of CYCLE_BASELINE: {sorted(CYCLE_BASELINE - now)}")
