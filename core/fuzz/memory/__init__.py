"""Fuzz's memory: entities' facts with provenance and trust, knowledge, decisions, the Knowledge files and recall.

See docs/memory-layers.md. Facts, knowledge, decisions and their links are projected tables, written through
events so they replay and undo. Trust, superseded and disputed are worked out when read, never stored.
"""
