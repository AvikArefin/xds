import json

import pytest

from xds import cli


def run(capsys, *argv):
    code = cli.main(["--json", *argv]) if argv[0] != "--text" else cli.main(list(argv[1:]))
    return code, capsys.readouterr()


def test_schema_emit_types_only_inside_the_checkout(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    code, out = run(capsys, "schema", "--emit-types")
    assert code == 2 and json.loads(out.out)["error"]["code"] == "NOT_IN_XDS_SOURCE"


def test_init_with_a_size(tmp_path, capsys):
    code, out = run(capsys, "init", str(tmp_path / "deck"), "--size", "1440x1080")
    assert code == 0 and json.loads(out.out)["format"] == {"width": 1440, "height": 1080}
    code, _ = run(capsys, "init", str(tmp_path / "other"), "--size", "1440x1080", "--format", "instagram-square")
    assert code == 2


def test_front_words():
    assert cli.front_axis("back") == "-z" and cli.front_axis("-x") == "-x" and cli.front_axis("z") == "+z"
    with pytest.raises(Exception):
        cli.front_axis("sideways")


def test_guide_and_check_note_an_outdated_agents_md(blank, capsys):
    (blank / "AGENTS.md").write_text("# old\n")
    code, out = run(capsys, "--text", "guide", str(blank))
    assert code == 0 and "`xds migrate .` updates it" in out.out
    code, out = run(capsys, "check", str(blank))
    assert json.loads(out.out)["agentsMdCurrent"] is False


def test_every_help_text_formats():
    """A stray % in a help string breaks `xds --help` (and, on Python 3.14, every command)."""
    import argparse

    def walk(parser):
        parser.format_help()
        for action in parser._actions:
            if isinstance(action, argparse._SubParsersAction):
                for sub in action.choices.values():
                    walk(sub)

    walk(cli.build_parser())
