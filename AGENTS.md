<claude-mem-context>
# Memory Context

# [speaqi-crm] recent context, 2026-04-24 4:44am GMT+2

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 47 obs (17,410t read) | 418,923t work | 96% savings

### Apr 22, 2026
1 11:37a 🔵 CRM Pipeline: Three Critical Issues Identified by User
3 11:38a 🔵 speaqi-crm: Contact Scopes, Bulk Edit, and Pipeline Visibility Architecture
5 11:40a 🔴 Removed Auto-Carry Logic That Was Silently Mutating Yesterday's Tasks
6 " 🟣 DMO/Holding Page (vinitaly) Gains Bulk Select, Promote-to-CRM, and Remove-from-List Actions
7 " 🟣 Bulk API Now Supports contact_scope Changes and Nullable Field Clearing
8 11:42a 🔵 useCRM.ts Has Broader Changes: Personal Contacts Feature Already Partially In-Flight
12 " 🔵 Commit "Fix DMO bulk actions and preserve yesterday schedule" Excludes useCRM.ts Auto-Carry Removal
15 11:54a 🟣 Vinitaly Page: Range Selection and List-Specific Bulk Delete
16 " 🔵 Vinitaly Page: Current Selection and Bulk Action Architecture
18 11:55a 🟣 Vinitaly Page: Shift-Click Range Selection Implemented
20 " 🔵 Vinitaly Page: write_file Changes Did NOT Persist — File Still Has Old Code
22 " 🟣 Vinitaly Page: Shift-Click Range Selection Successfully Applied
25 11:56a ✅ speaqi-crm Production Build Passes After Shift-Click Feature
29 12:10p 🟣 CRM Contact Import: OCR Data Extraction Feature Requested
30 " 🔵 CRM Contact Import Architecture: CSV-Only, No OCR Support
32 12:11p 🔵 speaqi-crm AI Stack: OpenAI-Only, No Anthropic SDK
34 " 🔵 Import Wizard UI: Full 3-Step Structure Mapped for OCR Integration
38 12:12p 🟣 csv-import.ts: Added `stringifyCsvRows` Utility for OCR Integration
40 " 🟣 New OCR API Endpoint: POST /api/import/ocr
42 12:13p 🟣 Import Wizard UI: OCR Mode Toggle Added to Step 1
44 " 🟣 Import Wizard CSS: New Mode Switch and Helper Styles Added
47 12:14p ✅ Production Build Successful: OCR Import Feature Compiled Clean
48 12:16p 🟣 CRM OCR Contact Import: Full Feature Committed and Build-Verified
### Apr 23, 2026
63 7:05p ⚖️ CRM Contacts: Filter System + Dashboard Pipeline Section Requested
64 " 🔵 speaqi-crm: Contacts Page Filters and Dashboard Architecture Mapped
68 7:07p 🔵 speaqi-crm: Full Data Model and API Layer Mapped for Deferred Scheduling Feature
79 " 🟣 Contacts Page: Bulk Deferred Scheduling + Quick Pipeline Move Added
82 7:09p 🔴 Dashboard CSS Patch Failed: globals.css oggi-bottom-grid Values Differ from Expected
85 " 🟣 Dashboard: "Top Pipeline in Corso" Widget Added with CSS
86 7:11p 🟣 speaqi-crm: Contact Filters, Bulk Deferred Scheduling, and Dashboard Pipeline Widget — Build Passed
91 7:12p ✅ speaqi-crm: Contact Filters + Bulk Scheduling + Dashboard Pipeline Committed to Main
93 " ✅ speaqi-crm Main Branch Pushed to GitHub
95 8:13p ⚖️ Contacts Page: Folder System + First/Last Selection UX Requested
96 " 🔵 Contacts vs Vinitaly: Shift+Click Range Selection Gap Identified
98 8:14p 🟣 Contacts Page: Shift+Click Range Selection + Folder System UI Added
100 " 🟣 Contacts Page: Folder Chips UI and CSS Added to globals.css
102 8:15p ✅ speaqi-crm Production Build: Successful (58 Static Pages)
104 8:40p 🟣 Contacts Page: Numeric Range Selection UI Added
105 " 🟣 Contacts Page: Range Selection CSS Classes Added
107 " ✅ speaqi-crm Production Build: Successful (58 Static Pages)
109 8:41p ✅ Contacts Range Selection Committed to Main
110 " ✅ speaqi-crm: Range Selection Feature Pushed to GitHub
112 8:58p 🔵 speaqi-crm: Missing 'personal_section' Column in contacts Table
114 " 🔵 speaqi-crm: personal_section Column Missing from Supabase contacts Table — No Fallback Handler Exists
116 8:59p 🔴 contacts/route.ts: Generalized Schema-Miss Fallback to Cover personal_section Column
118 " 🔴 contacts/[id]/route.ts: Generalized Schema-Miss Fallback Applied to PATCH Route
120 " ✅ speaqi-crm Production Build: Successful (58 Static Pages) After personal_section Fallback Fix

Access 419k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>