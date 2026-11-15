#!/usr/bin/env python3
"""Turn the smoke scripts' result lines into JUnit XML for CircleCI's Tests tab.

    results-to-junit.py OUT.xml suite=path [suite=path ...]

A result line starts with one of:
    ok:    a passed check
    FAIL:  a failed check (the lines that follow, up to the next result line, become its failure text)
    GAP:   coverage this run cannot give; reported as a skipped test so it is visible, never silently dropped
    INFO:  context only; kept in the suite's system-out
Anything else (step banners, logcat excerpts) is ignored unless it follows a FAIL line.
Missing files are skipped, so a run that died early still produces a valid report.
"""
import re
import sys
from pathlib import Path
from xml.sax.saxutils import escape, quoteattr

LINE = re.compile(r"^(ok|FAIL|GAP|INFO):\s*(.*)$")


def parse(path):
    cases, info, current = [], [], None
    for raw in Path(path).read_text(errors="replace").splitlines():
        m = LINE.match(raw)
        if m:
            kind, text = m.group(1), m.group(2).strip()
            current = None
            if kind == "INFO":
                info.append(text)
            else:
                current = {"kind": kind, "name": text, "body": []}
                cases.append(current)
        elif current is not None and current["kind"] == "FAIL" and raw.strip() and not raw.startswith("=="):
            current["body"].append(raw)
    return cases, info


def main(argv):
    if len(argv) < 3:
        print(__doc__)
        return 2
    out, suites, totals = Path(argv[1]), [], {"tests": 0, "failures": 0, "skipped": 0}
    for spec in argv[2:]:
        name, _, path = spec.partition("=")
        if not Path(path).is_file():
            continue
        cases, info = parse(path)
        f = sum(c["kind"] == "FAIL" for c in cases)
        s = sum(c["kind"] == "GAP" for c in cases)
        totals["tests"] += len(cases); totals["failures"] += f; totals["skipped"] += s
        xml = [f'  <testsuite name={quoteattr(name)} tests="{len(cases)}" failures="{f}" skipped="{s}" errors="0" time="0">']
        for c in cases:
            head = f'    <testcase classname={quoteattr(name)} name={quoteattr(c["name"][:240])} time="0"'
            if c["kind"] == "ok":
                xml.append(head + "/>")
            elif c["kind"] == "GAP":
                xml.append(head + f'><skipped message={quoteattr("coverage gap")}/></testcase>')
            else:
                body = escape("\n".join(c["body"][:60]))
                xml.append(head + f'><failure message={quoteattr(c["name"][:240])}>{body}</failure></testcase>')
        if info:
            xml.append("    <system-out>" + escape("\n".join(info)) + "</system-out>")
        xml.append("  </testsuite>")
        suites.append("\n".join(xml))
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<testsuites tests="{totals["tests"]}" failures="{totals["failures"]}" skipped="{totals["skipped"]}">\n'
        + "\n".join(suites) + "\n</testsuites>\n",
        encoding="utf-8",
    )
    print(f"junit: {totals['tests']} checks, {totals['failures']} failed, {totals['skipped']} coverage gaps -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
