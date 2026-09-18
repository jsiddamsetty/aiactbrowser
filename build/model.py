"""Namespaced IDs, routes, and cross-instrument citation routing."""

import re

import parse


PREFIX_CORPUS = {
    "gdl_bafin-": "bafin-ai", "kimig_": "kimig", "gdpr_": "gdpr",
    "dora_rct_": "dora", "dora_anx_": "dora", "dora_def_": "dora",
    "dora_": "dora", "rtsrmf_": "dora-rts-rmf", "dorar tsrmf_": "dora-rts-rmf",
    "dorartsrmf_": "dora-rts-rmf", "rtssub_": "dora-rts-sub",
    "dorartssub_": "dora-rts-sub", "itsreg_": "dora-its-register",
    "doraitsregister_": "dora-its-register", "marisk_": "marisk",
}


def corpus_of(raw_id):
    for prefix, corpus in PREFIX_CORPUS.items():
        if raw_id.startswith(prefix):
            return corpus
    return "aia"


def local_id(raw_id, corpus=None):
    corpus = corpus or corpus_of(raw_id)
    if corpus == "gdpr":
        if raw_id.startswith("gdpr_rct_"):
            return "rct_" + raw_id[len("gdpr_rct_"):]
        return "art_" + raw_id[len("gdpr_"):]
    if corpus == "kimig":
        return "par_" + raw_id[len("kimig_"):]
    if corpus == "bafin-ai":
        return "gdl_" + raw_id[len("gdl_bafin-"):]
    prefixes = {
        "dora": (("dora_rct_", "rct_"), ("dora_anx_", "anx_"),
                 ("dora_def_", "def_"), ("dora_", "art_")),
        "dora-rts-rmf": (("dorartsrmf_rct_", "rct_"), ("dorartsrmf_anx_", "anx_"),
                         ("rtsrmf_", "art_")),
        "dora-rts-sub": (("dorartssub_rct_", "rct_"), ("dorartssub_anx_", "anx_"),
                         ("rtssub_", "art_")),
        "dora-its-register": (("doraitsregister_rct_", "rct_"),
                              ("doraitsregister_anx_", "anx_"), ("itsreg_", "art_")),
        "marisk": (("marisk_", "module_"),),
    }
    for old, new in prefixes.get(corpus, ()):
        if raw_id.startswith(old):
            return new + raw_id[len(old):]
    return raw_id


def ns(raw_id, corpus=None):
    corpus = corpus or corpus_of(raw_id)
    return corpus + ":" + local_id(raw_id, corpus)


def route(node_id, para=None):
    corpus, local = node_id.split(":", 1)
    kinds = {"art_": "article", "rct_": "recital", "anx_": "annex",
             "def_": "term", "par_": "section", "module_": "module",
             "gdl_": "guidance", "omr_": "recital"}
    kind = next((value for prefix, value in kinds.items() if local.startswith(prefix)), "node")
    prefix = next((prefix for prefix in kinds if local.startswith(prefix)), "")
    result = "#/%s/%s/%s" % (corpus, kind, local[len(prefix):])
    return result + (("/" + para) if para else "")


LINK_RE = re.compile(r'(<a\s+class="xref"\s+data-node=")([^"]+)("[^>]*?href=")([^"]+)(")')


def namespace_html(body):
    def replace(match):
        target = ns(match.group(2))
        old_href = match.group(4).split("/")
        para = old_href[-1] if old_href and re.match(r"^(?:p|pt)\d+$", old_href[-1]) else None
        return match.group(1) + target + match.group(3) + route(target, para) + match.group(5)
    return LINK_RE.sub(replace, body or "")


def namespace_nodes(nodes):
    mapping = {node["id"]: ns(node["id"]) for node in nodes}
    for node in nodes:
        old = node["id"]
        node["id"] = mapping[old]
        node["corpus"] = node["id"].split(":", 1)[0]
        if node.get("html"):
            node["html"] = namespace_html(node["html"])
        if node.get("htmlDe"):
            node["htmlDe"] = namespace_html(node["htmlDe"])
    return mapping


def namespace_edges(edges, mapping):
    out = []
    for edge in edges:
        if edge["s"] not in mapping or edge["t"] not in mapping:
            continue
        converted = dict(edge, s=mapping[edge["s"]], t=mapping[edge["t"]])
        out.append(converted)
    return out


INSTRUMENTS = {
    "aia": {"names": ("AI Act",), "celex": "2024/1689"},
    "gdpr": {"names": ("GDPR",), "celex": "2016/679"},
    "dora": {"names": ("DORA",), "celex": "2022/2554"},
    "dora-rts-rmf": {"names": ("RTS RMF", "RMF"), "celex": "2024/1774"},
    "dora-rts-sub": {"names": ("RTS Subcontracting",), "celex": "2025/532"},
    "dora-its-register": {"names": ("ITS",), "celex": "2024/2956"},
    "dsa": {"names": ("DSA",), "celex": "2022/2065", "eli": "reg/2022/2065"},
    "dma": {"names": ("DMA",), "celex": "2022/1925", "eli": "reg/2022/1925"},
    "ucpd": {"names": ("UCPD",), "celex": "2005/29", "eli": "dir/2005/29"},
    "led": {"names": ("LED",), "celex": "2016/680", "eli": "dir/2016/680"},
    "eudpr": {"names": ("EUDPR",), "celex": "2018/1725", "eli": "reg/2018/1725"},
    "tfeu": {"names": ("TFEU",), "celex": None},
    "teu": {"names": ("TEU",), "celex": None},
    "charter": {"names": ("Charter",), "celex": None},
    "echr": {"names": ("ECHR",), "celex": None},
    "cer": {"names": ("CER",), "celex": "2022/2557", "eli": "dir/2022/2557"},
}

OVERRIDES = {
    ("aia:gdl_pp-3.6", "26"): "dsa", ("aia:gdl_pp-3.6", "38"): "dsa",
    ("aia:gdl_pp-3.6", "27"): "dsa",
}


def named_instrument(tail):
    sample = tail[:150]
    for slug, info in INSTRUMENTS.items():
        if info.get("celex") and info["celex"] in sample:
            return slug
        if any(re.search(r"\b%s\b" % re.escape(name), sample) for name in info["names"]):
            return slug
    if re.search(r"\bthe Charter\b", sample):
        return "charter"
    return None


def routed_edges(nodes, existing_ids):
    """Route named Article references across corpora and create external stubs."""
    edges, stubs, seen = [], {}, set()
    for node in nodes:
        source_corpus = node["id"].split(":", 1)[0]
        default = "dora" if source_corpus == "bafin-ai" else source_corpus
        for match in parse.ART_RE.finditer(node.get("text", "")):
            nums = [match.group(1).lower()]
            nums.extend(hit.group(1).lower() for hit in re.finditer(
                r"(?:,|and|to|or|[-–])\s*(\d{1,3}[a-z]?)\b", match.group(2) or "", re.I))
            named = named_instrument(node["text"][match.end():])
            for number in nums:
                target_corpus = OVERRIDES.get((node["id"], number), named or default)
                if target_corpus == source_corpus:
                    continue
                target = "%s:art_%s" % (target_corpus, number)
                if target not in existing_ids:
                    if target_corpus in {"aia", "gdpr", "dora", "dora-rts-rmf",
                                          "dora-rts-sub", "dora-its-register"}:
                        continue
                    target = "ext:%s:art_%s" % (target_corpus, number)
                    info = INSTRUMENTS.get(target_corpus, {})
                    eli = info.get("eli")
                    stubs[target] = {
                        "id": target, "type": "external", "corpus": "ext",
                        "label": "%s Article %s" % (target_corpus.upper(), number),
                        "title": "External provision", "text": "",
                        "externalUrl": ("https://eur-lex.europa.eu/eli/%s/art_%s/oj/eng" %
                                        (eli, number)) if eli else None,
                    }
                key = (node["id"], target)
                if key not in seen and target != node["id"]:
                    edges.append({"s": node["id"], "t": target, "k": "xcites", "w": 1})
                    seen.add(key)
    return list(stubs.values()), edges
