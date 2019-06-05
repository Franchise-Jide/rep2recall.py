import re


def anki_mustache(s: str, d: dict) -> str:
    for k, v in d.items():
        s = re.sub(r"{{(\S+:)?%s}}" % re.escape(k), v, s)

    s = re.sub(r"{{#(\S+)}}(.*){{\1}}", lambda m: m[2] if m[1] in d.keys() else "", s, flags=re.DOTALL)
    s = re.sub(r"{{[^}]+}}", "", s)

    return s