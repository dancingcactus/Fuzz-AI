"""js/vocab.js is the core's names for the UI; it must match what core/scripts/make_vocab.py writes now."""

import importlib.util
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def load_script():
    spec = importlib.util.spec_from_file_location("make_vocab", os.path.join(ROOT, "core", "scripts", "make_vocab.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class Vocab(unittest.TestCase):
    def test_the_ui_copy_is_current(self):
        mod = load_script()
        with open(mod.OUT, encoding="utf-8") as f:
            have = f.read()
        self.assertEqual(have, mod.render(), "js/vocab.js is out of date: run core/scripts/make_vocab.py")

    def test_it_loads_before_the_scripts_that_use_it(self):
        with open(os.path.join(ROOT, "index.html"), encoding="utf-8") as f:
            page = f.read()
        self.assertLess(page.index('src="js/vocab.js"'), page.index('src="js/live.js"'))
