"""Curated instrument relations and the first reviewed requirement matrix."""

TOPICS = [
    ("scope", "Scope and classification"), ("governance", "Governance and accountability"),
    ("risk-management", "Risk management"), ("models", "Models and development"),
    ("data", "Data and data governance"), ("testing", "Testing and validation"),
    ("cybersecurity", "Robustness and cybersecurity"), ("logging", "Record-keeping and logging"),
    ("monitoring", "Monitoring in operation"), ("human-oversight", "Human oversight and automated decisions"),
    ("transparency", "Transparency to affected persons"), ("incidents", "Incidents and reporting"),
    ("third-parties", "Third parties and outsourcing"), ("continuity", "Business continuity"),
    ("competence", "Staff competence and AI literacy"), ("supervision", "Supervision and enforcement"),
]


def tag(provision, topic, reason, role=None, applies=None, effect="requires", instrument=None):
    qualifiers = {"effect": effect}
    if role: qualifiers["role"] = role
    if applies: qualifiers["applies"] = applies
    row = {"provision": provision, "topic": topic, "reason": reason, "qualifiers": qualifiers}
    if instrument:
        row["instrument"] = instrument
    return row


TAGS = [
    tag("aia:art_2", "scope", "Defines the Regulation's scope."),
    tag("aia:art_5", "scope", "Lists prohibited AI practices.", applies="all AI systems"),
    tag("aia:art_6", "scope", "Classifies high-risk AI systems.", applies="high-risk AI systems"),
    tag("aia:art_17", "governance", "Requires a provider quality-management system.", "provider", "high-risk AI systems"),
    tag("aia:art_9", "risk-management", "Requires a continuous risk-management system.", "provider", "high-risk AI systems"),
    tag("aia:art_11", "models", "Requires technical documentation.", "provider", "high-risk AI systems"),
    tag("aia:art_10", "data", "Sets data and data-governance requirements.", "provider", "high-risk AI systems"),
    tag("aia:art_15", "testing", "Requires accuracy, robustness and cybersecurity testing.", "provider", "high-risk AI systems"),
    tag("aia:art_15", "cybersecurity", "Requires resilience against errors, faults and attacks.", "provider", "high-risk AI systems"),
    tag("aia:art_12", "logging", "Requires automatic event logging.", "provider", "high-risk AI systems"),
    tag("aia:art_72", "monitoring", "Requires post-market monitoring.", "provider", "high-risk AI systems"),
    tag("aia:art_14", "human-oversight", "Requires effective human oversight.", "provider", "high-risk AI systems"),
    tag("aia:art_50", "transparency", "Sets transparency duties for certain AI systems."),
    tag("aia:art_73", "incidents", "Requires serious-incident reporting.", "provider", "high-risk AI systems"),
    tag("aia:art_25", "third-parties", "Allocates responsibilities along the AI value chain."),
    tag("aia:art_4", "competence", "Requires sufficient AI literacy."),
    tag("aia:art_74", "supervision", "Allocates market-surveillance authority."),
    tag("gdpr:art_24", "governance", "Makes controllers responsible for demonstrable compliance.", "controller", "personal data processing"),
    tag("gdpr:art_35", "risk-management", "Requires data-protection impact assessment for high-risk processing.", "controller", "personal data processing"),
    tag("gdpr:art_25", "models", "Requires data protection by design and default.", "controller", "personal data processing"),
    tag("gdpr:art_5", "data", "Sets principles for personal-data processing.", "controller", "personal data processing"),
    tag("gdpr:art_32", "cybersecurity", "Requires security appropriate to processing risk.", applies="personal data processing"),
    tag("gdpr:art_30", "logging", "Requires records of processing activities.", applies="personal data processing"),
    tag("gdpr:art_22", "human-oversight", "Restricts solely automated decisions with significant effects.", "controller", "personal data processing"),
    tag("gdpr:art_13", "transparency", "Requires information when data are collected.", "controller", "personal data processing"),
    tag("gdpr:art_33", "incidents", "Requires personal-data-breach notification.", "controller", "personal data processing"),
    tag("gdpr:art_28", "third-parties", "Sets processor contracting and oversight duties.", "controller", "personal data processing"),
    tag("gdpr:art_39", "competence", "Defines data-protection officer tasks.", applies="personal data processing"),
    tag("gdpr:art_83", "supervision", "Sets administrative fines."),
    tag("dora:art_5", "governance", "Places ICT-risk governance with the management body.", "financial entity"),
    tag("dora:art_6", "risk-management", "Requires a sound ICT risk-management framework.", "financial entity"),
    tag("dora:art_8", "risk-management", "Requires identification of ICT-supported functions and assets.", "financial entity"),
    tag("dora:art_9", "cybersecurity", "Requires ICT protection and prevention measures.", "financial entity"),
    tag("dora:art_10", "monitoring", "Requires detection of anomalous activities and incidents.", "financial entity"),
    tag("dora:art_17", "incidents", "Requires an ICT-incident management process.", "financial entity"),
    tag("dora:art_24", "testing", "Sets general digital operational resilience testing requirements.", "financial entity"),
    tag("dora:art_28", "third-parties", "Requires management of ICT third-party risk.", "financial entity"),
    tag("dora:art_11", "continuity", "Requires ICT business-continuity policy and response plans.", "financial entity"),
    tag("dora:art_13", "competence", "Requires learning and evolving from incidents and tests.", "financial entity"),
    tag("dora-rts-rmf:art_15", "models", "Specifies change-management controls for ICT systems.", "financial entity"),
    tag("dora-rts-rmf:art_5", "data", "Specifies encryption and cryptographic controls.", "financial entity"),
    tag("dora-rts-rmf:art_16", "testing", "Specifies ICT project acquisition, development and maintenance controls.", "financial entity"),
    tag("dora-rts-rmf:art_12", "logging", "Specifies logging procedures, systems and retention periods.", "financial entity"),
    tag("marisk:module_AT-4.3.4", "models", "Applies governance requirements to models, technology-based innovation and AI.", "institution"),
    tag("marisk:module_AT-4.3.4", "human-oversight", "Requires appropriate explainability of model results.", "institution"),
    tag("marisk:module_AT-7.2", "cybersecurity", "Addresses technically and organisationally adequate resources.", "institution"),
    tag("marisk:module_AT-6", "logging", "Sets documentation and retention expectations.", "institution"),
    tag("marisk:module_AT-9", "third-parties", "Governs outsourcing and excludes DORA-covered ICT services.", "institution"),
    tag("marisk:module_AT-7.3", "continuity", "Sets emergency-management requirements.", "institution"),
    tag("marisk:module_AT-7.1", "competence", "Sets staffing qualification requirements.", "institution"),
    tag("kimig:par_2", "supervision", "Names German market-surveillance authorities."),
    tag("kimig:par_15", "supervision", "Creates administrative offences and fines."),
    tag("kimig:par_1", "scope", "Defines the German implementing law's scope."),
    tag("kimig:par_14", "testing", "Supports testing through real-world regulatory-sandbox arrangements."),
    tag("kimig:par_7", "incidents", "Governs cooperation and information exchange."),
    tag("bafin-ai:gdl_I.1", "scope", "Explains the AI-system concept used by the guidance.", effect="guidance only"),
    tag("bafin-ai:gdl_II.2", "governance", "Explains governance and organisational expectations for AI.", "financial entity", effect="guidance only"),
    tag("bafin-ai:gdl_II.3", "risk-management", "Applies DORA's ICT risk-management framework to AI.", "financial entity", effect="guidance only"),
    tag("bafin-ai:gdl_III.1", "models", "Explains secure software-development expectations for AI.", "financial entity", effect="guidance only"),
    tag("bafin-ai:gdl_III.2", "testing", "Explains risk-based testing of AI systems.", "financial entity", effect="guidance only"),
    tag("bafin-ai:gdl_V.1", "cybersecurity", "Explains adversarial AI threats and cybersecurity measures.", "financial entity", effect="guidance only"),
    tag("bafin-ai:gdl_IV.1", "logging", "Explains logging, operation, monitoring and deinstallation controls.", "financial entity", effect="guidance only"),
    tag("bafin-ai:gdl_IV.1", "monitoring", "Explains operational monitoring for AI systems.", "financial entity", effect="guidance only"),
    tag("bafin-ai:gdl_Annex", "human-oversight", "Illustrates human review in an LLM assistant case study.", "financial entity", effect="guidance only"),
    tag("bafin-ai:gdl_V.2", "data", "Explains AI data-security expectations.", "financial entity", effect="guidance only"),
    tag("bafin-ai:gdl_V.3", "incidents", "Explains when AI events may be reportable ICT incidents.", "financial entity", effect="guidance only"),
    tag("bafin-ai:gdl_IV.2", "third-parties", "Explains cloud and third-party considerations for AI operations.", "financial entity", effect="guidance only"),
    tag("bafin-ai:gdl_IV.1", "continuity", "Covers operation and controlled deinstallation of AI systems.", "financial entity", effect="guidance only"),
    tag("bafin-ai:gdl_II.2", "competence", "Calls for suitable knowledge and responsibilities for AI.", "financial entity", effect="guidance only"),
    tag("aia:gdl_pp-2.3", "scope", "Commission guidance explains placing on the market and putting into service.", effect="guidance only", instrument="commission-guidance"),
    tag("aia:gdl_hr-1", "scope", "Draft Commission guidance explains high-risk classification.", applies="high-risk AI systems", effect="guidance only", instrument="commission-guidance"),
    tag("aia:gdl_hr-2.7", "risk-management", "Draft guidance explains the Article 6 classification assessment.", effect="guidance only", instrument="commission-guidance"),
    tag("aia:gdl_pp-10.1.1", "human-oversight", "Commission guidance discusses fundamental-rights assessment safeguards.", effect="guidance only", instrument="commission-guidance"),
]


RELATIONS = [
    {"from": "commission-guidance", "to": "aia", "kind": "interprets",
     "grounding": ["aia:gdl_pp-2.3", "aia:gdl_hr-1"],
     "explanation": "Commission guidance explains prohibited practices and high-risk classification under the AI Act."},
    {"from": "kimig", "to": "aia", "kind": "implements", "grounding": ["kimig:par_1"],
     "explanation": "The German law implements national functions required by the AI Act."},
    {"from": "aia", "to": "gdpr", "kind": "builds-on", "grounding": ["aia:art_26/p9", "aia:art_27/p4", "aia:art_4a"],
     "explanation": "The AI Act reuses GDPR concepts and impact-assessment work."},
    {"from": "aia", "to": "authority:bafin", "kind": "designates", "grounding": ["aia:art_74/p6"],
     "explanation": "The financial supervisor is market-surveillance authority for relevant high-risk systems."},
    {"from": "kimig", "to": "authority:bafin", "kind": "designates", "grounding": ["kimig:par_2/p3", "kimig:par_6"],
     "explanation": "The KI-MIG names BaFin for AI systems connected with regulated financial activity."},
    {"from": "kimig", "to": "authority:bnetza", "kind": "designates", "grounding": ["kimig:par_2"],
     "explanation": "The KI-MIG names the Bundesnetzagentur as the general German market-surveillance authority."},
    {"from": "kimig", "to": "dora", "kind": "carves-out", "grounding": ["kimig:par_10"],
     "explanation": "The KI-MIG carves DORA financial entities out of specified cooperation criteria."},
    {"from": "marisk", "to": "aia", "kind": "recognises-ai",
     "grounding": ["marisk:module_AT-4.3.4/p1", "aia:art_3"],
     "explanation": "MaRisk AT 4.3.4 expressly extends its model-governance requirements to automated models, technology-enabled innovation and AI. It does not make every MaRisk model an AI system; that classification is assessed under the AI Act definition."},
    {"from": "dora-rts-rmf", "to": "dora", "kind": "specifies", "grounding": ["dora-rts-rmf:art_1"],
     "explanation": "The delegated regulation specifies DORA's ICT risk-management framework."},
    {"from": "dora-rts-sub", "to": "dora", "kind": "specifies", "grounding": ["dora-rts-sub:art_1"],
     "explanation": "The delegated regulation specifies subcontracting requirements under DORA."},
    {"from": "dora-its-register", "to": "dora", "kind": "specifies", "grounding": ["dora-its-register:art_1"],
     "explanation": "The implementing regulation supplies templates for DORA's register of information."},
    {"from": "bafin-ai", "to": "dora", "kind": "applies", "grounding": ["bafin-ai:gdl_I.1"],
     "explanation": "BaFin explains how DORA ICT-risk duties apply to AI use."},
    {"from": "marisk", "to": "dora", "kind": "carves-out", "grounding": ["marisk:module_AT-9"],
     "explanation": "MaRisk AT 9 excludes ICT services governed by DORA's third-party regime."},
]


# Concrete bridges between instruments.  Unlike RELATIONS, which describes
# the legal architecture, these explain the operational concept or compliance
# mechanism through which two texts interact.
INTERACTIONS = [
    {
        "from": "aia", "to": "gdpr",
        "summary": "The AI Act imports data-protection concepts and reuses GDPR compliance work when AI processes personal data.",
        "mechanisms": [
            {"name": "Profiling definition", "kind": "imports a definition",
             "explanation": "The AI Act definition of profiling points to the GDPR definition, so both texts use the same concept.",
             "grounding": ["aia:def_52", "gdpr:art_4/pt4"]},
            {"name": "Bias detection with sensitive data", "kind": "controlled permission",
             "explanation": "The AI Act permits strictly necessary use of special-category data to detect and correct bias, while adding safeguards on top of the GDPR regime.",
             "grounding": ["aia:art_4a", "aia:art_10/p2", "gdpr:art_9", "gdpr:art_30"]},
            {"name": "DPIA and fundamental-rights assessment", "kind": "reuses an assessment",
             "explanation": "AI Act deployers can use GDPR data-protection impact-assessment work when preparing the AI Act fundamental-rights assessment.",
             "grounding": ["aia:art_26/p9", "aia:art_27/p4", "gdpr:art_35"]},
        ],
    },
    {
        "from": "bafin-ai", "to": "dora",
        "summary": "BaFin turns DORA's general ICT controls into concrete expectations for AI used by financial entities.",
        "mechanisms": [
            {"name": "AI inside the ICT risk framework", "kind": "applies an existing framework",
             "explanation": "AI systems are governed as ICT assets and processes within DORA's risk-management framework.",
             "grounding": ["bafin-ai:gdl_II.3", "dora:art_6", "dora-rts-rmf:art_27"]},
            {"name": "Risk-based AI testing", "kind": "specifies testing practice",
             "explanation": "BaFin's AI testing guidance connects model testing to DORA development and maintenance controls.",
             "grounding": ["bafin-ai:gdl_III.2", "dora-rts-rmf:art_16"]},
            {"name": "AI incident reporting", "kind": "routes incidents into DORA",
             "explanation": "An event involving an AI system can enter DORA's ICT incident classification and reporting process.",
             "grounding": ["bafin-ai:gdl_V.3", "dora:art_17", "dora:art_22"]},
            {"name": "Cloud and third-party AI", "kind": "extends outsourcing controls",
             "explanation": "Operating AI in the cloud brings the service into DORA's ICT third-party and subcontracting controls.",
             "grounding": ["bafin-ai:gdl_IV.2", "dora:art_28", "dora-rts-sub:art_3"]},
        ],
    },
    {
        "from": "marisk", "to": "dora",
        "summary": "DORA draws the boundary around MaRisk outsourcing and permits a combined ICT risk-control function.",
        "mechanisms": [
            {"name": "ICT outsourcing boundary", "kind": "carves out DORA services",
             "explanation": "ICT services subject to DORA's third-party regime fall outside MaRisk AT 9's outsourcing regime.",
             "grounding": ["marisk:module_AT-9", "dora:art_28", "dora:art_29", "dora:art_30"]},
            {"name": "ICT risk-control function", "kind": "allows organisational combination",
             "explanation": "MaRisk connects its compliance-function organisation to DORA's ICT risk-control function.",
             "grounding": ["marisk:module_AT-4.4.2", "dora:art_6/p4"]},
        ],
    },
    {
        "from": "marisk", "to": "aia",
        "summary": "MaRisk AT 4.3.4 expressly covers AI in its model-governance perimeter, while the AI Act separately determines whether a specific system is an AI system.",
        "mechanisms": [
            {"name": "Explicit AI coverage, not automatic classification", "kind": "keeps two tests distinct",
             "explanation": "AT 4.3.4 applies MaRisk's model requirements to automated models, technology-enabled innovation and AI. A MaRisk model is not automatically an AI system: the AI Act Article 3 definition remains the classification test.",
             "grounding": ["marisk:module_AT-4.3.4/p1", "aia:art_3"]},
            {"name": "Governance of a covered AI model", "kind": "adds financial-sector model controls",
             "explanation": "For AI covered by AT 4.3.4, MaRisk adds requirements concerning assessment before use, data quality, validation, model-result overrides and explainability. These complement, rather than replace, applicable AI Act obligations.",
             "grounding": ["marisk:module_AT-4.3.4/p2", "marisk:module_AT-4.3.4/p3", "marisk:module_AT-4.3.4/p4", "marisk:module_AT-4.3.4/p5", "marisk:module_AT-4.3.4/p6", "aia:art_9", "aia:art_10", "aia:art_14", "aia:art_15"]},
        ],
    },
    {
        "from": "kimig", "to": "aia",
        "summary": "The German implementation law supplies national authorities, procedures and sanctions for the AI Act.",
        "mechanisms": [
            {"name": "Financial market supervision", "kind": "assigns an authority",
             "explanation": "The AI Act assigns supervision of relevant financial-sector AI to the financial supervisor; KI-MIG names BaFin nationally.",
             "grounding": ["aia:art_74/p6", "kimig:par_2/p3", "kimig:par_6"]},
            {"name": "Real-world testing", "kind": "implements a national procedure",
             "explanation": "KI-MIG implements the national procedure for testing high-risk AI systems in real-world conditions.",
             "grounding": ["kimig:par_14", "aia:art_60"]},
            {"name": "Enforcement and fines", "kind": "supplies national enforcement",
             "explanation": "KI-MIG adds German administrative offences and enforcement machinery around AI Act duties.",
             "grounding": ["kimig:par_15", "aia:art_99"]},
        ],
    },
    {
        "from": "commission-guidance", "to": "aia",
        "summary": "Commission guidance explains how the AI Act's prohibitions and high-risk classification work in concrete cases.",
        "mechanisms": [
            {"name": "Prohibited practices", "kind": "interprets Article 5",
             "explanation": "The adopted guidelines explain the scope and application of the prohibited-practices rules.",
             "grounding": ["aia:gdl_pp-2.3", "aia:art_5"]},
            {"name": "High-risk classification", "kind": "interprets Article 6 and Annex III",
             "explanation": "The draft guidance explains classification and the filter for systems that may fall outside the high-risk category.",
             "grounding": ["aia:gdl_hr-1", "aia:gdl_hr-2.7", "aia:art_6", "aia:anx_III"]},
        ],
    },
]


# A practical reading path for financial entities using AI.  DORA is not an
# AI-specific regulation: these are the DORA controls that become material
# when an AI system supports a financial entity's business processes.
DORA_AI_LENS = {
    "title": "DORA for fintech AI",
    "scope": "Use this lens for any AI system used by a financial entity — including customer-facing, decision-support, fraud, risk, compliance, payments and internal-operation use cases — where the system or its supplier supports an ICT-enabled business process.",
    "caveat": "The lens identifies operational-resilience duties that can apply around an AI deployment. It does not turn DORA into an AI-specific rulebook; applicability still depends on the entity, the system's role and whether it supports a critical or important function.",
    "cards": [
        {
            "title": "Start with MaRisk's AI model definition",
            "applies_when": "A financial institution uses an automated model, technology-enabled innovation or AI in a process governed by MaRisk.",
            "why": "AT 4.3.4 expressly brings automated models, technology-enabled innovation and AI into its model-governance perimeter. It anchors assessment before use, data quality, rules for model-result overrides, regular validation and explainability — the governance baseline that sits alongside DORA's ICT-risk framework.",
            "corpora": ["marisk", "dora", "bafin-ai"],
            "grounding": ["marisk:module_AT-4.3.4/p1", "marisk:module_AT-4.3.4/p2", "marisk:module_AT-4.3.4/p3", "marisk:module_AT-4.3.4/p5", "marisk:module_AT-4.3.4/p6", "dora:art_6", "bafin-ai:gdl_II.3"],
        },
        {
            "title": "Put the AI system inside ICT governance",
            "applies_when": "The system, its data pipeline, model service or integration supports a financial-entity process.",
            "why": "Assign ownership, identify the AI-supported function and its dependencies, and bring the system into the ICT risk-management framework rather than managing it as an isolated innovation project.",
            "corpora": ["dora", "dora-rts-rmf", "bafin-ai"],
            "grounding": ["dora:art_5", "dora:art_6", "dora:art_8", "dora-rts-rmf:art_27", "bafin-ai:gdl_II.3"],
        },
        {
            "title": "Protect and monitor the production AI stack",
            "applies_when": "The AI system processes, stores or exposes business, customer or model data in production.",
            "why": "Treat model endpoints, prompts, retrieval stores, training and inference data, identities and integrations as ICT assets: protect them and detect anomalous activity that could affect confidentiality, integrity or availability.",
            "corpora": ["dora", "dora-rts-rmf", "bafin-ai"],
            "grounding": ["dora:art_9", "dora:art_10", "dora-rts-rmf:art_5", "dora-rts-rmf:art_12", "bafin-ai:gdl_V.2"],
        },
        {
            "title": "Test AI changes and operational resilience",
            "applies_when": "A model, prompt, dataset, retrieval source, workflow, hosting environment or integration changes — especially where it supports a critical or important function.",
            "why": "Use risk-based testing and controlled change management to test the AI service and its supporting ICT environment, then feed weaknesses and failures back into the risk framework.",
            "corpora": ["dora", "dora-rts-rmf", "bafin-ai"],
            "grounding": ["dora:art_13", "dora:art_24", "dora-rts-rmf:art_15", "dora-rts-rmf:art_16", "bafin-ai:gdl_III.2"],
        },
        {
            "title": "Handle AI failures as ICT incidents",
            "applies_when": "An AI failure, compromise, outage or degraded output affects an ICT-supported business process or could disrupt a critical or important function.",
            "why": "Route the event through ICT incident management, assess its classification and reporting implications, and maintain response, recovery and continuity arrangements for the affected service.",
            "corpora": ["dora", "bafin-ai"],
            "grounding": ["dora:art_11", "dora:art_17", "dora:art_22", "bafin-ai:gdl_IV.1", "bafin-ai:gdl_V.3"],
        },
        {
            "title": "Control cloud, foundation-model and AI-service providers",
            "applies_when": "The firm uses an external model, AI platform, cloud provider, managed service, data provider or subcontractor for an AI-enabled process.",
            "why": "Identify the dependency, assess whether it supports a critical or important function, apply the ICT third-party strategy and contractual controls, trace subcontracting, and record the arrangement using DORA's register framework.",
            "corpora": ["dora", "dora-rts-sub", "dora-its-register", "bafin-ai"],
            "grounding": ["dora:art_28", "dora:art_29", "dora:art_30", "dora-rts-sub:art_3", "dora-its-register:art_1", "bafin-ai:gdl_IV.2"],
        },
    ],
}
