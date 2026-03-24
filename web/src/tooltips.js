const tooltips = {
  // ── Summary table columns ──────────────────────────────────────────────
  Agency:             "The federal department or agency that awarded or posted this contract (e.g. Dept of Defense, Dept of Energy).",
  SubAgency:          "The specific bureau, command, or office within the parent agency that ran the procurement (e.g. U.S. Army Corps of Engineers).",
  NAICS:              "North American Industry Classification System — a 6-digit code that categorizes the type of work being done. Identical to the industry codes used for taxes and business registration.",
  NoticeID:           "Notice ID — the unique tracking number SAM.gov assigns to this specific opportunity posting. Use it to search SAM.gov directly or reference it in any questions to the contracting officer.",
  PSC:                "Product Service Code — a 4-character code that describes exactly what the government is buying (product or service). More specific than NAICS.",
  State:              "The U.S. state where the work is primarily performed.",
  Period:             "The contract's period of performance — start date on the left, end date on the right. Color coding: red = past, amber = closing within 6 months, green = 6+ months out.",
  Window:             "The window for this opportunity — when it was posted (left) and the deadline to submit a proposal (right). Color coding: red = past deadline, amber = closing within 6 months, green = 6+ months out.",
  Amount:             "The total dollar amount obligated (committed) on this contract — real money the government has promised to pay.",
  EstValue:           "The government's estimated dollar range for this opportunity. Often blank — SAM.gov doesn't always include it.",

  // ── Contract identity ──────────────────────────────────────────────────
  PIID:               "Procurement Instrument Identifier — the unique contract number assigned by the contracting office. Think of it as the contract's serial number.",
  SolicitationNumber: "The reference number for the solicitation (RFP or RFQ) that led to this contract. Use it to look up the original bid documents on SAM.gov.",
  MajorProgram:       "A named government program this contract supports (e.g. a specific weapons system or infrastructure initiative). Not always populated.",

  // ── Money fields ───────────────────────────────────────────────────────
  AwardAmount:        "The total dollar amount obligated at time of award — what the government committed to pay.",
  BaseAmount:         "The base contract value, not counting any options. Options are additional work periods the government can choose to exercise later.",
  CeilingAmount:      "The maximum total value if all contract options are exercised. The contract cannot legally exceed this number.",
  FederalObligation:  "The cumulative amount of money the government has formally obligated (committed) on this contract to date.",
  TotalOutlayed:      "The amount actually paid out (spent) to the contractor so far. Lower than obligation until work is delivered and invoiced.",

  // ── Dates ──────────────────────────────────────────────────────────────
  StartDate:          "The date the contract's period of performance begins — when the contractor can start work.",
  EndDate:            "The date the contract's period of performance ends — the deadline for all work to be complete.",
  DaysRemaining:      "Calendar days remaining until the contract end date. Negative = already ended.",
  DateSigned:         "The date the contracting officer signed and executed the contract.",
  LastModified:       "The last date this contract record was updated in the federal procurement system.",
  FiscalYear:         "The federal fiscal year in which this contract was awarded. The federal fiscal year runs October 1 – September 30 (so FY2024 = Oct 2023 – Sep 2024).",
  PostedDate:         "The date this opportunity was first posted on SAM.gov and became visible to vendors.",
  ResponseDeadline:   "The deadline for vendors to submit proposals or bids. After this date, submissions are typically not accepted.",
  ArchiveDate:        "The date this listing will be archived on SAM.gov and removed from active searches.",

  // ── Opportunity fields ─────────────────────────────────────────────────
  SolicitationNumber: "The official reference number for this bid request — you'll put this on your proposal. Format varies by agency (e.g. 12345-24-R-0001). Use it to find the original documents on SAM.gov.",
  NoticeType:         "The type of SAM.gov posting. Solicitation = active bid open now. Pre-Solicitation = advance notice, not yet open. Sources Sought = market research only, no award will come from this posting alone. Award Notice = contract already awarded.",
  ContractStructure:  "How the contract's performance period is structured. A 'base year + 4 option years' contract runs for one year, then the government can extend it up to 4 more years at their discretion — for a maximum of 5 years total.",

  // ── Opportunity-specific intel ─────────────────────────────────────────
  SizeStandard:       "Good news for small businesses — this number is on your side. It's the maximum annual revenue a company can earn and still qualify as 'small' for this contract. If you earn LESS than this, you're eligible to bid. The government uses this to keep big corporations out and reserve the contract for smaller companies like yours.",
  AwardBasis:         "How the government will decide who wins. LPTA (Lowest Price Technically Acceptable) = cheapest bid that meets the requirements wins. Best Value = government weighs price against quality, past performance, and technical approach.",
  WageDetermination:  "The minimum hourly wage the contractor must pay workers on this contract, set by the Dept. of Labor under the Service Contract Act or Davis-Bacon Act. This is a floor, not a ceiling — you can pay more.",

  // ── Competition & contract structure ───────────────────────────────────
  ContractType:       "How the contractor gets paid. Common types: Firm-Fixed-Price (FFP) = set price regardless of cost; Cost-Plus = contractor's costs reimbursed plus a fee; Time & Materials = hourly rate plus materials.",
  SetAside:           "Restricts who can bid. Examples: Small Business Set-Aside (only small businesses), 8(a) (minority-owned), HUBZone (businesses in underserved areas), SDVOSB (service-disabled veterans).",
  CompetitionType:    "How the government structured competition for this contract. Full & Open = anyone can bid. Set-Aside = only certain small businesses can bid (good for you). Sole Source = only one vendor was invited — you're out unless you're that vendor. Brand Name Only = a specific product is required, though you may still compete if you can supply it.",
  ExtentCompeted:     "A more detailed description of how competition was structured — e.g. whether it was a full open competition, limited to small businesses, or not competed at all.",
  NumberOfOffers:     "How many vendors submitted bids or proposals. 1 = effectively sole source. Higher numbers indicate real competition.",
  LegalBasis:         "The legal authority cited to justify limiting competition (if applicable). References specific sections of the Federal Acquisition Regulation (FAR).",

  // ── FAR Competition Exceptions ────────────────────────────────────────────
  'FAR6302':          "Federal Acquisition Regulation exceptions that allow agencies to skip competitive bidding. Each exception requires justification and approval.",
  'FAR6302-1':        "Only One Source — no other supplier can provide the item or service. Used for unique patents, proprietary technology, or exclusive capabilities.",
  'FAR6302-2':        "Urgency — an unusual and compelling emergency won't allow time for competitive bidding. Common during disasters, pandemics, military operations, or critical system failures.",
  'FAR6302-3':        "Industrial Mobilization — needed to keep essential suppliers in business for national defense.",
  'FAR6302-4':        "International Agreement — required by treaty or agreement with another country.",
  'FAR6302-5':        "Authorized by Statute — Congress specifically allowed this sole-source award.",
  'FAR6302-6':        "National Security — disclosure of the agency's needs would compromise security.",
  'FAR6302-7':        "Public Interest — the head of the agency determines competition is not in the public interest.",
  SolicitationProcedures: "The method used to solicit offers — e.g. sealed bidding (lowest price wins) vs. negotiated acquisition (best value).",
  CommercialItem:     "Whether the goods or services are commercially available — i.e. sold to the general public, not custom-built for the government. Commercial items have streamlined acquisition rules.",
  SubcontractingPlan: "For large contracts, prime contractors must submit a plan showing what portion of work they'll award to small businesses as subcontractors.",
  LaborStandards:     "Whether this contract is subject to prevailing wage laws (Davis-Bacon Act for construction, Service Contract Act for services). These laws require minimum wage rates set by the Dept of Labor.",
  NoticeType:         "The type of SAM.gov posting — e.g. Solicitation (active bid request), Pre-Solicitation (advance notice), Award Notice (contract was awarded), or Sources Sought (market research only).",

  // ── People & organizations ─────────────────────────────────────────────
  CO:                 "Contracting Officer — the government official with legal authority to award, modify, and terminate contracts. The CO's signature makes a contract binding.",
  Recipient:          "The company or organization that won and was awarded this contract.",
  UEI:                "Unique Entity Identifier — a 12-character alphanumeric ID assigned by SAM.gov to every business or organization registered to do business with the federal government. Replaced the DUNS number in 2022.",
  BusinessSize:       "Whether the contractor is classified as a small or large business under SBA size standards, which vary by NAICS code.",
  SmallBusiness:      "Confirms whether the awardee met the SBA's definition of a small business at the time of award.",
  BusinessClassifications: "Socioeconomic categories the contractor qualifies for — e.g. woman-owned, veteran-owned, HUBZone, 8(a), disadvantaged. These affect set-aside eligibility.",
  CongressionalDistrict: "The U.S. Congressional district where the work is performed or the contractor is located. Used for reporting and oversight.",

  // ── Successor tracking ────────────────────────────────────────────────────
  SuccessorContract:    "When a contract ends, the government often issues a follow-on or recompete. This shows the likely successor contract we detected — the new award that replaced this one.",
  IncumbentRetained:    "Did the same company win the recompete? 'Retained' means the incumbent kept the work. 'Lost' means a competitor took over.",
  MatchConfidence:      "How confident we are this is the true successor. Based on timing, description similarity, value, and agency match. High = 80%+, Medium = 50-79%, Low = below 50%.",
}

export default tooltips
