# Problem reports: privacy analysis

**This is not legal advice.** It is a factual description of what the `problem-reports` plugin does with data, set against the texts of several privacy laws. Legal readings below are marked as such ("appears", "a likely reading is"). Counsel should confirm every reading before an operator relies on it. Nothing here claims that any deployment meets any law.

Sources were opened on 2026-11-04 unless marked "(not verified)". Texts are paraphrased, not quoted, except for short phrases.

## 1. What the feature is

- The plugin is off unless it is listed in the configuration.
- It refuses to start without a `privacy-url` (an https address or a path on the same site) and a `contact` (an email address or an https address). So it cannot run without a privacy notice and a contact point.
- The status page shows a "Report a problem" form. Before sending, the form shows a short notice: what is collected, why, for how long, and links to `privacy-url` and `contact`.
- The form posts JSON to `POST /api/v1/problem-reports`. The body is capped at 8 KB. The endpoint sends no CORS headers, and it refuses a request whose `Origin` names another site or whose `Sec-Fetch-Site` is not `same-origin`. So other sites cannot post from a visitor's browser.
- The page sets no cookies. It uses no `localStorage` or `sessionStorage`. It reads nothing from the device and writes nothing to it, beyond the request the visitor chooses to send.
- Reports are stored in the operator's own Postgres or SQLite database, through the existing database plugin.

## 2. Data inventory

| Field | Source | Purpose | Retention |
|---|---|---|---|
| `description` (required, 10 to 2000 chars) | Typed by the visitor | Say what is wrong | `retention` (default 90 days, from 1 to 365 days), then deleted by a purge that runs at start and every hour |
| `service` (optional) | Chosen by the visitor from keys shown on the page | Route the report to a service | Same |
| `details` (optional, up to 2000 chars) | Typed by the visitor | Extra context | Same |
| `page` (optional, same-site path) | Sent by the form | Know which page the visitor was on | Same. Any query string or fragment is dropped before storage |
| `received_at` (UTC, to the second) | Server clock | Order reports; spot incidents in time | Same |
| `country` (ISO 3166-1 alpha-2, or empty) | A request header named by `country-header`, trusted only when the request came through the configured number of `trusted-proxies` (and, if `proxy-networks` is set, arrived from one of them), the header appears exactly once, and the value is two capital letters other than `XX` | Spot regional incidents | Same |
| `browser`, `browser_major`, `os` (families and major version only) | Parsed coarsely from the User-Agent header | Spot browser- or OS-specific faults | Same |
| Reference ID (`PR-` and 16 base32 characters, 80 random bits) | Server | Lets the visitor name their report for access or erasure | Stored with the report; same |
| Honeypot `website` | Hidden field humans leave empty | Spam filter | A filled one makes the server silently discard the whole report; never stored |
| Rate-limit entry: HMAC-SHA256(IP) under a per-process random key, plus a counter | Derived in memory from the connection IP | Limit to `per-client-limit` (default 5) per client per hour; a `global-limit` (default 200) caps all reports per hour | Memory only. An entry's window is one hour from the client's first report, and expired entries are swept at least hourly, so an entry lasts at most about two hours. The key is made at start and never written anywhere, so it is lost on restart |

**Never stored:** the IP address, the raw User-Agent string, cookies, and device identifiers.

**Admin access.** A bearer token, stored hashed in the configuration (the same scheme as the incidents plugin), protects:

- `GET /api/v1/admin/problem-reports` (paged; filters `service`, `country`, `from`, `to`)
- `GET /api/v1/admin/problem-reports/{id}`
- `DELETE /api/v1/admin/problem-reports/{id}` (for erasure)
- `GET /api/v1/admin/problem-reports/summary` (counts by country and by service over the last hour)

**Country header notes.**

- On a Google Cloud Application Load Balancer, a custom request header can be set to the `{client_region}` variable. Google documents this as a Unicode CLDR region code (for example `US` or `FR`) estimated from the client IP, and says most such codes match ISO 3166 codes. So a value may not always be an ISO 3166-1 code.
- On Cloudflare, `CF-IPCountry` is a request header sent to the origin when visitor location headers are turned on. It carries an ISO 3166-1 alpha-2 code, with `XX` for unknown and `T1` for Tor.
- Some front ends set a header such as `x-country-code` on the **response**. That is not a request header, so the application never receives it. Pointing `country-header` at it would leave `country` empty.

## 3. GDPR (Regulation (EU) 2016/679)

### 3.1 Does the GDPR reach the operator?

- Art. 3(1): the GDPR applies to processing in the context of an EU establishment of the controller.
- Art. 3(2): it also applies to a controller outside the EU when processing relates to (a) offering goods or services to people in the EU, or (b) monitoring their behaviour in the EU.
- Recital 23: the mere fact that a website can be reached from the EU is not enough to show an intention to offer services there. Language, currency or mention of EU users can show it.
- Recital 24: "monitoring" means tracking people on the internet, including later profiling.
- A likely reading is that a non-EU operator of a public status page is caught only if it targets EU users. The form does not track or profile visitors. Whether an operator targets EU users is a fact about that operator. Counsel should confirm.

### 3.2 Is this personal data? (Art. 4(1), Recital 26, *Breyer*)

- Art. 4(1): personal data is any information about an identified or identifiable person, directly or indirectly. Location data and online identifiers are named as examples.
- Recital 26: identifiability is judged by all means "reasonably likely" to be used, by the controller or anyone else. Cost, time and technology count. Pseudonymised data stays personal data. Truly anonymous data is outside the GDPR.
- *Breyer* (C-582/14, 19 October 2016, ECLI:EU:C:2016:779), decided under the older Directive 95/46: a dynamic IP address held by a website operator can be personal data for that operator. It is enough that the operator has legal means to identify the person with extra data held by a third party, such as the internet provider (paras 41 to 49). Identification does not count if it is legally prohibited or would need a disproportionate effort (para 46).
- What this means here, as a likely reading:
  - **Free text.** `description` and `details` may contain names, emails or other details the visitor chooses to type. Those are personal data.
  - **IP in memory.** The IP address is personal data under the *Breyer* test. Deriving an HMAC from it, counting with it and discarding it are all "processing" under Art. 4(2), even if nothing is written to disk.
  - **The HMAC value.** It is pseudonymised, not anonymous (Art. 4(5)). While the process runs, the key is in memory. IPv4 has only about four billion addresses, so anyone holding the key could reverse a hash by trying them all. After a restart the key is gone and that route closes.
  - **Country, time, browser, OS.** On their own they are coarse. Together they may single out a person, for example one report from a small country at a given second. The operator's front end (a load balancer or CDN) may keep access logs with IP addresses and timestamps. If it does, matching `received_at` against those logs is a means that may be "reasonably likely" to be used. This is an open question (section 8).

### 3.3 Lawful basis: Art. 6(1)(f) legitimate interests

Art. 6(1)(f) allows processing that is necessary for a legitimate interest of the controller, unless the person's rights override it, in particular for a child. It is not available to public authorities acting in their tasks. Recital 47 says the person's reasonable expectations matter. Recital 49 says processing strictly necessary for network and information security can be a legitimate interest. The EDPB describes a three-step test in its Guidelines 1/2024 (not verified: seen only in search excerpts).

**Step 1: purpose (is there a legitimate interest?)**

- Learn about outages and faults that monitoring did not catch.
- Spot incidents limited to one region, browser or service.
- Protect the endpoint from abuse (rate limits, spam filter).
- These are lawful, specific and present interests. A likely reading is that they qualify.

**Step 2: necessity (is the data needed, and is there a less intrusive way?)**

- The description is the report itself.
- Country and browser/OS are needed only for the regional and client-specific purposes. They are kept coarse: no city, no full version, no raw string.
- Rate limiting needs some per-client key. A keyed hash in memory, expiring within an hour, is less intrusive than storing the IP.
- `received_at` to the second is finer than incident spotting may need. Counsel may ask whether minute precision would serve the purpose equally.

**Step 3: balancing**

- For the visitor: the report is voluntary. The notice is shown before sending. There is no tracking, no profiling, no cookies and no sharing beyond the operator's hosting. Data is deleted after a fixed period. A visitor would likely expect a problem report to be stored and read.
- Against: free text may hold anything, including special category data. A child may submit. Country plus time may single someone out.
- A likely reading is that the balance favours the operator for the fields listed, given the safeguards. Each operator must do and record its own test. Counsel should confirm.

Because the basis is Art. 6(1)(f), the visitor has the right to object under Art. 21(1). The notice should say so (Art. 13(2)(b)).

### 3.4 Minimisation and storage limitation (Art. 5(1)(c) and (e))

- Art. 5(1)(c): data must be adequate, relevant and limited to what is necessary. The design stores no IP, no raw User-Agent, no cookies and no device IDs. Browser and OS are reduced to families. The body is capped.
- Art. 5(1)(e): data must not be kept in identifiable form longer than needed. The default `retention` is 90 days. The maximum is 365 days. An hourly job deletes older rows. The operator should be able to explain why its chosen period is needed.
- Backups of the database are outside the plugin. Rows may live on in backups after the purge or a `DELETE`. That is for the operator to handle.

### 3.5 Notice at collection (Art. 13)

Art. 13 lists what a controller must tell the person when it collects data from them. The form's short notice covers part of it. The page at `privacy-url` must carry the rest. The plugin cannot know these facts, so the operator must supply them.

| Art. 13 item | Short form notice | Operator must supply at `privacy-url` |
|---|---|---|
| 1(a) identity and contact of the controller (and EU representative, if any) | Link to `contact` | Yes: legal name, address, contact |
| 1(b) data protection officer contact, where one exists | No | Yes, if a DPO is appointed |
| 1(c) purposes and legal basis | Purposes | Yes: state Art. 6(1)(f) |
| 1(d) the legitimate interests pursued | Partly | Yes: name the interests in section 3.3 |
| 1(e) recipients or categories | No | Yes: for example the hosting provider, CDN or load balancer provider |
| 1(f) transfers outside the EU and the safeguard used | No | Yes, where data leaves the EU (section 3.9) |
| 2(a) storage period | Yes: the `retention` value | Repeat it |
| 2(b) rights: access, rectification, erasure, restriction, objection, portability | No | Yes, with how to use the reference ID |
| 2(c) right to withdraw consent | Not applicable (basis is not consent) | No |
| 2(d) right to complain to a supervisory authority | No | Yes |
| 2(e) whether providing data is required | Implied (voluntary) | Say that the report is voluntary |
| 2(f) automated decision-making | No | Say that there is none |

### 3.6 Access and erasure (Art. 15, 17 and 11)

- Art. 15 gives a right to confirm whether data is processed, to see it, and to get a copy (Art. 15(3)).
- Art. 17(1) gives a right to erasure on listed grounds. Two are relevant here: the data is no longer needed (a), or the person objects under Art. 21(1) and there is no overriding ground (c).
- Art. 11: if the controller does not need to identify the person, it need not collect extra data just to answer rights requests. Where it cannot identify the person, Art. 15 to 20 do not apply, unless the person gives extra information that allows identification.
- How the design serves this:
  - The visitor gets a random reference ID after sending.
  - To use a right, the visitor sends that ID to the `contact`.
  - The operator uses `GET .../problem-reports/{id}` to answer an access request, and `DELETE .../problem-reports/{id}` to erase.
  - The reference ID is the "extra information" Art. 11(2) contemplates. A visitor without it can still describe the report (text, time), and the operator can search with the list filters.
- Limits to note: anyone who holds a reference ID can ask about that report. The ID is a random value, not a proof of identity. Whether the operator should check more before releasing free text is a question for counsel.

### 3.7 Records of processing (Art. 30)

- Art. 30(1) requires a written record of processing activities.
- Art. 30(5) exempts organisations with fewer than 250 staff, unless the processing is likely to risk people's rights, is not occasional, or includes special category or criminal data.
- A form that is always available may be "not occasional". A likely reading is that the exemption may not apply, and a short record is prudent. Counsel should confirm. Section 2 of this document can serve as a starting point.

### 3.8 Security (Art. 32)

Art. 32(1) asks for measures suited to the risk, such as pseudonymisation and encryption, and the ability to keep systems confidential, intact and available. Measures in the design:

- The admin token is stored only as a hash in the configuration. Failed token attempts are limited per address, in memory, for one minute (the incidents plugin's mechanism). This concerns administrators, not visitors.
- Per-client and global hourly rate limits, an 8 KB body cap and a honeypot.
- No CORS headers, so other sites cannot post from a visitor's browser.
- The visitor's IP is pseudonymised in memory and never written.
- Minimisation and a fixed purge (section 3.4).

Outside the plugin, the operator controls TLS, database access and encryption, backups, and front-end log retention. Those choices bear on Art. 32 too.

### 3.9 Transfers (Chapter V)

Art. 44 allows a transfer to a country outside the EU only under Chapter V conditions (adequacy, safeguards or a listed derogation). If an EU visitor's report is stored in a region outside the EU, a transfer may occur. The hosting region is the operator's choice. See section 8.

## 4. ePrivacy Directive 2002/58/EC, Art. 5(3)

### 4.1 The rule

Art. 5(3), as replaced by Directive 2009/136/EC, says: storing information on, or gaining access to information already stored in, a user's terminal equipment needs consent after clear information. Two exemptions apply:

- storage or access only to carry out the transmission of a communication;
- storage or access strictly necessary for a service the user has explicitly requested.

### 4.2 Why no consent banner appears needed

- The page stores nothing on the device: no cookies, no web storage.
- The page reads nothing from the device beyond the request itself.
- The visitor explicitly asks to send a report by pressing send. A likely reading is that sending what the visitor typed falls within the "strictly necessary for a service explicitly requested" exemption.
- A likely reading is therefore that Art. 5(3) does not require a consent banner for this form. Counsel should confirm. This reading holds only while the page adds no fingerprinting, pixels, analytics scripts or other tracking.

### 4.3 What EDPB Guidelines 2/2023 say

The EDPB adopted version 2.0 of Guidelines 2/2023 on the technical scope of Art. 5(3) on 7 October 2024. They read the provision broadly:

- "Information" covers any information, not just personal data (paras 7 to 12). Where it came from does not matter (para 31).
- "Gaining access" covers cases where the accessing party instructs the device to send information, for example through JavaScript that makes the browser send requests (paras 32 and 33), or through a protocol (para 34).
- Para 43 names HTTP headers, including the User-Agent, as context data. It says relying on such mechanisms to collect information, for example for fingerprinting, "can lead to" Art. 5(3) applying.
- Para 44 says information the user provides in the browser is not "accessed" while it stays on the device, but Art. 5(3) applies once it, or anything derived from it, leaves the device.
- Para 55 says IP addresses trigger Art. 5(3) only when they come from the user's terminal equipment, and that the entity must otherwise take the steps Art. 5(3) requires unless it can ensure they do not.
- The guidelines do not analyse the exemptions (paras 4, 40 and 56). Each case needs its own check.

### 4.4 Open point: the User-Agent header

- Every browser sends the User-Agent header on its own, on every request. The page does not ask for it with special code.
- The server reads it and keeps only browser family, major version and OS family. The raw string is not stored. It is not used for fingerprinting.
- Under para 43, a reading exists that parsing a header to collect information is "gaining access". If so, the next question is whether an exemption applies. Browser and OS help diagnose the reported problem, but they are not strictly needed to deliver the report.
- This is unresolved. Counsel should confirm whether coarse parsing of the User-Agent falls within Art. 5(3), and if it does, whether an exemption covers it. The same question, at lower weight, applies to using the IP for rate limiting (para 55).
- Art. 5(3) is transposed into each member state's law. National rules and regulator guidance may differ (EDPB para 4).

## 5. India: Digital Personal Data Protection Act, 2023 (DPDP Act)

### 5.1 Commencement first

The Act was published in the Gazette of India on 11 August 2023. Its sections come into force on dates the Central Government appoints. By G.S.R. 843(E), dated 13 November 2025 (Gazette of India, opened):

- On publication: s.1(2), s.2, ss.18 to 26, 35, 38 to 43 and s.44(1) and (3). These are mainly definitions and the Data Protection Board.
- One year after publication: s.6(9) and s.27(1)(d) (consent managers).
- Eighteen months after publication: ss.3 to 5, s.6(1) to (8) and (10), ss.7 to 17, s.27 (except (1)(d)), ss.28 to 34, 36, 37 and s.44(2).

So, as a likely reading, on 2026-11-04 the duties discussed below (ss.3 to 17) are not yet in force. On a plain count, eighteen months after 13 November 2025 is 13 May 2027. The notification states only "eighteen months"; counsel should confirm the exact day. Secondary sources report a 2026 proposal to shorten this period. No official notification of a change was found (not verified).

### 5.2 Definitions (s.2)

- s.2(t): personal data is any data about an individual who is identifiable by or in relation to that data.
- s.2(i): a Data Fiduciary decides the purpose and means of processing. The operator is the Data Fiduciary.
- s.2(j): the Data Principal is the person the data is about. For a child, it includes the parents.
- s.2(f): a child is anyone under eighteen.
- s.2(x): processing covers wholly or partly automated operations on digital personal data, including collection, storage, use and erasure.

### 5.3 Applicability (s.3)

- s.3(a): the Act applies to processing of digital personal data within India.
- s.3(b): it also applies outside India when processing relates to offering goods or services to people in India.
- s.3(c): it does not apply to purely personal or domestic use, or to data the person has made public.
- A likely reading is that an operator processing in India is covered for reports from any visitor. An operator outside India is covered for reports linked to offering services to people in India. Counsel should confirm.

### 5.4 Grounds (s.4), consent (s.6) and legitimate uses (s.7)

- s.4: processing is allowed only for a lawful purpose, with consent (s.6) or for a "certain legitimate use" (s.7).
- s.6(1): consent must be free, specific, informed, unconditional and unambiguous, with a clear affirmative action.
- s.7(a): a fiduciary may process data for the specified purpose for which the person **voluntarily provided** it, where the person has not said she does not consent. The Act's illustrations: a shopper who gives her phone number for a receipt; a person who messages a broker for help finding a flat.
- Applying s.7(a) here, as a likely reading:
  - `description`, `details`, `service` and `page` are voluntarily provided for a specified purpose shown in the notice. They appear to fit s.7(a).
  - `received_at`, `country`, `browser`/`os` and the in-memory IP hash are added by the server. It is less clear that the person "provided" them. One reading is that they come with the voluntary act of sending. Another is that they need consent. This is an open point (section 8).
  - Once the person says she does not consent, processing under s.7(a) should stop. Illustration II shows the broker stopping when told.

### 5.5 Notice (s.5)

- s.5(1) ties the notice to a request for consent under s.6. It must state the data and purpose, how to withdraw consent and use rights, and how to complain to the Board.
- s.5(3): the notice must be available in English or any language of the Eighth Schedule to the Constitution.
- If the basis is s.7(a), a likely reading is that s.5 is not strictly triggered. The form shows a notice anyway. Language options under s.5(3) are the operator's matter.

### 5.6 Duties of the fiduciary (s.8)

- s.8(5): take reasonable security safeguards against breach.
- s.8(6): tell the Board and each affected person about a breach.
- s.8(7): erase data when consent is withdrawn or the purpose is no longer served, unless a law requires retention.
- s.8(9): publish the business contact of a DPO, if one applies, or of a person who can answer questions about processing. The required `contact` setting supports this.
- s.8(10): set up an effective way to redress grievances.

### 5.7 Children (s.9)

s.9(1) requires verifiable parental consent before processing a child's data. s.9(3) bars tracking and behavioural monitoring of children. The form cannot tell a child from an adult. See section 8.

### 5.8 Rights (ss.11 to 13)

- s.11(1): a right to a summary of the data and processing, and of whom it was shared with. It applies to consent "including consent as referred to in clause (a) of section 7". So it reaches s.7(a) processing.
- s.12(3): a right to erasure on request, unless retention is needed for the purpose or by law. It also reaches s.7(a) processing.
- s.13: a right to readily available grievance redress, which must be used before going to the Board (s.13(3)).
- The reference ID and the admin get/delete routes support ss.11 and 12 the same way as in section 3.6.

### 5.9 Significant Data Fiduciary (s.10) and transfers (s.16)

- s.10: the Central Government may notify a fiduciary as a Significant Data Fiduciary, based on volume and sensitivity of data and other factors. Only a notified fiduciary carries the extra duties. Nothing in this feature appears to make an operator one.
- s.16(1): the Government may restrict transfers to countries it notifies. No such list was checked for this document (not verified).

## 6. DPDP Rules, 2025

### 6.1 Notification and commencement (verified)

The Digital Personal Data Protection Rules, 2025 were notified as **G.S.R. 846(E), dated 13 November 2025**, Gazette of India, Extraordinary, Part II, Section 3(i), No. 760 (egazette.gov.in, opened). The gazette copy is digitally signed 14 November 2025. Rule 1 sets the dates:

| Rules | In force |
|---|---|
| 1, 2 and 17 to 21 | On publication: 13 November 2025 |
| 4 (consent managers) | One year after publication: on a plain count, 13 November 2026 |
| 3, 5 to 16, 22 and 23 | Eighteen months after publication: on a plain count, 13 May 2027 |

The gazette states "one year" and "eighteen months", not calendar dates. Corrigenda to the Rules (reported as G.S.R. 892(E) and G.S.R. 113(E)) were not opened (not verified).

### 6.2 Rules that bear on this feature (not yet in force on 2026-11-04)

- **Rule 3 (notice).** A notice must stand on its own, use clear and plain language, give an itemised list of the data and the specified purpose, and give a link and other means to withdraw consent, use rights and complain to the Board.
- **Rule 6 (security).** Minimum safeguards include encryption, obfuscation or masking; access control; logs and monitoring; and backups. **Rule 6(1)(e)** asks the fiduciary to keep such logs and personal data for **one year** to detect and investigate unauthorised access, unless another law says otherwise.
- **Rule 8(1) and (2).** Erasure after periods set in the Third Schedule, with 48 hours' warning. The Third Schedule names e-commerce, online gaming and social media intermediaries above set user numbers. A status page does not appear to be one of those classes.
- **Rule 8(3).** A fiduciary must keep personal data, associated traffic data and processing logs for **at least one year** from processing, for the purposes in the Seventh Schedule (state uses under s.17 and SDF assessment), then erase them unless another law needs more.
- **Rule 9.** Publish prominently the business contact of the DPO, or of a person who can answer questions, and mention it in every reply to a rights request.
- **Rule 14.** Publish how to make a rights request and what identifier is needed. Rule 14(5) lists "application reference number" among identifiers. The reference ID appears to fit. Rule 14(3) sets a grievance response period of no more than ninety days.
- **Rule 15.** Transfers abroad are subject to any requirements the Government sets by order about making data available to a foreign State.

**Conflict to flag.** The plugin's default `retention` is 90 days and its maximum is 365 days. Rules 6(1)(e) and 8(3), once in force, appear to require keeping some personal data and logs for at least one year. Whether they reach problem reports, and how they fit the GDPR's storage limitation for the same rows, is an open question for counsel (section 8).

## 7. Other regimes

### 7.1 UK GDPR and Data Protection Act 2018

- The UK GDPR keeps the GDPR's structure for this analysis: personal data, Art. 6(1)(f), Art. 13 notices, rights, records and security. The Information Commissioner's Office is the supervisory authority. The PECR regulations carry the UK version of the ePrivacy cookie rule (not verified: the UK texts could not be opened).
- The Data (Use and Access) Act 2025 amends the UK GDPR, the DPA 2018 and PECR in stages. legislation.gov.uk refused automated access, so commencement could not be checked. Search excerpts point to the Commencement No. 6 Regulations 2026 (SI 2026/82): most data protection changes from 5 February 2026, and s.103 (complaints by data subjects) from 19 June 2026 (not verified). Counsel should confirm what is in force and whether it changes any reading here.

### 7.2 California: CCPA as amended by the CPRA

- The CCPA's duties fall on a "business" (Cal. Civ. Code § 1798.140(d)). In outline, that is a for-profit entity that collects consumers' personal information, does business in California and meets at least one threshold:
  - (A) annual gross revenue above $25,000,000 as adjusted. The California Privacy Protection Agency set it at **$26,625,000 from 1 January 2025** (cppa.ca.gov, opened). The Agency adjusts it in odd-numbered years. Its page showed no 2027 figure on 2026-11-04.
  - (B) buys, sells or shares the personal information of 100,000 or more consumers or households (statute text not opened; not verified).
  - (C) earns half or more of its revenue from selling or sharing personal information (statute text not opened; not verified).
- The plugin does not sell or share report data.
- Threshold (A) depends on the operator's total revenue, not on the status page. A likely reading is that a non-commercial operator, or one below every threshold, is not a "business", so the CCPA's duties would not apply to it. Counsel should confirm for the actual operator.

## 8. Unresolved questions for counsel

1. **Country, time, browser and OS.** Is the stored combination personal data under GDPR Art. 4(1) and Recital 26, and DPDP s.2(t)? Does it matter whether the front end keeps access logs with IP and time that could be matched to `received_at`? Would minute precision change the answer?
2. **The in-memory HMAC of the IP.** A likely reading is that this is processing of personal data (GDPR Art. 4(2); DPDP s.2(x)), even though it is transient and never written. Confirm that Art. 6(1)(f) (with Recital 49) and, in India, s.7(a) or another ground cover it. Confirm whether it needs a line in the notice.
3. **User-Agent and Art. 5(3).** Is coarse parsing of a header the browser sends by itself "gaining access" under the ePrivacy Directive, read with EDPB Guidelines 2/2023 para 43? If so, is any exemption available?
4. **DPDP s.7(a) scope.** Does "voluntarily provided" cover the fields the server adds, or only what the visitor typed?
5. **Cross-border transfers.** Where is the database hosted, and where are the visitors? Does a report from the EU stored outside the EU need a Chapter V mechanism? Does a report from India stored outside India meet s.16 and Rule 15? Do the CDN or load balancer providers transfer data on their own account?
6. **Retention conflict.** Do DPDP Rules 6(1)(e) and 8(3), once in force, require one-year retention of report data or logs? If so, how does that fit the plugin's default and maximum, and GDPR Art. 5(1)(e) for the same rows?
7. **Grievance and contact duties in India.** Does the `contact` setting meet s.8(9), s.8(10) and Rules 9 and 14 once in force, including the response period? Is a named grievance officer needed? An operator becomes a Significant Data Fiduciary only if notified under s.10; a likely reading is that a status page operator is not one.
8. **EU representative.** If a non-EU operator falls under Art. 3(2), does the Art. 27(2)(a) exception (occasional, low-risk, no large-scale special category data) apply, or must it name a representative in the EU?
9. **Children.** A child may send a report. The DPDP Act needs verifiable parental consent before processing a child's data (s.9(1)), and treats anyone under eighteen as a child. GDPR Art. 8 applies only to consent-based information society services, but Art. 6(1)(f) gives children's interests extra weight. How should an operator treat a report that is clearly from a child?
10. **Special category data in free text.** A visitor may type health, beliefs or other Art. 9(1) data into `description` or `details`. Is that likely enough to need a separate Art. 9(2) condition, or is prompt deletion on discovery enough? Should the notice ask visitors not to include personal details?
11. **Records and representative thresholds.** Is the form "occasional" for Art. 30(5) and Art. 27(2)?
12. **Rights requests by reference ID.** Is the reference ID alone enough to release a copy of free text under Art. 15 and s.11, or should the operator check more?
13. **Summary endpoint.** Counts by country and service over one hour can be very small. Can a small count single out a person, and does that matter for the admins who see it?

## 9. Sources

All accessed 2026-11-04.

- GDPR, Regulation (EU) 2016/679, official text: EUR-Lex <https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679>. EUR-Lex refused automated access. The same official text was read from the EU Publications Office by CELEX number: <http://publications.europa.eu/resource/celex/32016R0679.ENG>. Opened: Recitals 23, 24, 26, 47, 49; Art. 3, 4(1), 4(2), 4(5), 5, 6(1)(f), 8, 9(1), 11, 13, 15, 17, 21, 27, 30, 32, 44.
- Directive 2009/136/EC (replacing Art. 5(3) of Directive 2002/58/EC), via the Publications Office: <http://publications.europa.eu/resource/celex/32009L0136.ENG>. EUR-Lex page for 2002/58/EC: <https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32002L0058> (not opened; the amended Art. 5(3) wording was checked in 2009/136/EC).
- EDPB Guidelines 2/2023 on Technical Scope of Art. 5(3) of ePrivacy Directive, version 2.0, adopted 7 October 2024: <https://www.edpb.europa.eu/system/files/documents/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf>. Opened: paras 1 to 56.
- EDPB Guidelines 1/2024 on processing based on Art. 6(1)(f): <https://www.edpb.europa.eu/system/files/2024-10/edpb_guidelines_202401_legitimateinterest_en.pdf> (not verified: seen in search excerpts only).
- CJEU, Case C-582/14 *Breyer*, 19 October 2016, ECLI:EU:C:2016:779. CURIA: <https://curia.europa.eu/juris/liste.jsf?num=C-582/14> (CURIA did not render for automated access). Text read from the Publications Office: <http://publications.europa.eu/resource/celex/62014CJ0582.ENG>. Opened: paras 41 to 49 and the operative part.
- Digital Personal Data Protection Act, 2023 (No. 22 of 2023), Gazette of India, 11 August 2023: <https://egazette.gov.in/WriteReadData/2023/248045.pdf>. Opened: ss.2 to 17. India Code and meity.gov.in pages did not render for automated access.
- G.S.R. 843(E), 13 November 2025, commencement of the DPDP Act: <https://egazette.gov.in/WriteReadData/2025/267647.pdf>. Opened.
- G.S.R. 846(E), 13 November 2025, Digital Personal Data Protection Rules, 2025: <https://egazette.gov.in/WriteReadData/2025/267650.pdf>. Opened: Rules 1 to 3, 6 to 9, 14, 15, Third and Seventh Schedules.
- MeitY data protection framework page: <https://www.meity.gov.in/data-protection-framework> (not verified: the page did not render for automated access).
- UK GDPR and DPA 2018: <https://www.legislation.gov.uk/ukpga/2018/12> (not verified: refused automated access).
- Data (Use and Access) Act 2025 (Commencement No. 6 and Transitional and Saving Provisions) Regulations 2026, SI 2026/82: <https://www.legislation.gov.uk/uksi/2026/82/made> (not verified: refused automated access; dates taken from search excerpts).
- California Privacy Protection Agency, "Updated Monetary Thresholds in CCPA": <https://www.cppa.ca.gov/regulations/cpi_adjustment.html>. Opened.
- Cal. Civ. Code § 1798.140: <https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1798.140> (not verified: refused automated access).
- Google Cloud, custom headers for Application Load Balancers: <https://docs.cloud.google.com/load-balancing/docs/https/custom-headers>. Opened.
- Cloudflare, HTTP request headers (`CF-IPCountry`): <https://developers.cloudflare.com/fundamentals/reference/http-headers/>. Opened.
