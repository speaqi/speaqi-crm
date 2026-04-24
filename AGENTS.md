<claude-mem-context>
# Memory Context

# [speaqi-crm] recent context, 2026-04-24 8:33am GMT+2

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (17,325t read) | 492,166t work | 96% savings

### Apr 23, 2026
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
### Apr 24, 2026
122 5:02a 🔵 speaqi-crm: 500 Error on Contact Creation — Missing 'personal_section' Column
123 5:03a 🔵 contacts/route.ts Fallback Logic Exists Locally but Error Still Fires in Production
125 5:04a 🔴 contacts/route.ts POST: personal_section and email_draft_note Excluded from Insert Payload by Default
129 " ✅ speaqi-crm Production Build: Successful After contacts/route.ts Fix (58 Static Pages)
131 5:07a 🔵 speaqi-crm: contacts/route.ts Fix Not Yet Committed or Pushed to GitHub
132 " ✅ speaqi-crm: Fix Deployed to Railway Production via railway up
134 " 🔵 crm.speaqi.com Infrastructure: Railway europe-west4 + Cloudflare CDN + Fastly Edge
136 5:09a 🔴 crm.ts createActivities: metadata Normalized to Empty Object When Null/Undefined
139 5:10a ✅ speaqi-crm: Second Railway Deployment — crm.ts metadata Fix Live, Health Check Passes
148 6:07a 🟣 speaqi-crm Import Page: Manual CSV Field Mapping UI Added
149 6:08a 🟣 speaqi-crm Import Page: Field Mapping Grid CSS Added and Deployed
151 6:11a 🔵 Vinitaly clickers_3705433.csv — Column Structure Mapped
152 " 🔴 csv-import.ts: Duplicate and Empty Header Deduplication in parseCsvText
153 " 🟣 speaqi-crm Import Page: Full Manual Field Mapping Feature Shipped to Production
157 6:51a 🔵 speaqi-crm: Collaborator Auth Requirements — Password Login and Per-User Contact Scoping
158 " 🔵 speaqi-crm: Auth Architecture Mapped — Login Exists, team_members Are Not Auth Users
160 " 🔵 speaqi-crm: Database Schema Fully Mapped — RLS Blocks Collaborator Auth Without Schema Changes
168 6:52a 🔵 speaqi-crm: requireRouteUser Architecture — Token-Scoped Supabase Client, No Role Resolution
169 6:54a 🟣 speaqi-crm: Collaborator Auth — requireRouteUser Extended with workspaceUserId, isAdmin, memberName
170 " 🟣 speaqi-crm: Team Members API — Admin-Only CRUD Enforcement + Supabase Auth Account Creation
174 6:55a 🟣 speaqi-crm: Collaborator Contact Scoping — responsible Filter Applied to All Contact Sub-Resource Routes
178 " 🟣 speaqi-crm: Collaborator Scoping — Bulk and Task Routes Fully Locked Down
182 6:56a 🟣 speaqi-crm: useCRM Hook — isAdmin State Propagated to Frontend from /api/team-members Response
185 " 🟣 speaqi-crm: Team Settings UI + Pipeline Stages — Admin-Only Controls Enforced in Frontend and API
189 6:57a 🔴 speaqi-crm: team-members GET/POST — Switched to Service Role Client to Bypass RLS for Collaborator Reads
190 6:58a 🟣 speaqi-crm: Collaborator Auth — RLS Migration Created, Service Role Fix Applied to [id] Routes, Production Deployed
191 7:00a 🔵 speaqi-crm: Dashboard page.tsx — Full Layout and Section Architecture Mapped
192 7:02a 🟣 dashboard/page.tsx: Dashboard Layout Reordered — Top Pipeline Now Above Week Timeline

Access 492k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>

## Collaborator access — verification checklist

If a team member sees an empty CRM after login, check in Supabase:

1. **`team_members` row**: `user_id` must be the workspace owner’s `auth.users.id`. The collaborator must be linked via **`auth_user_id`** = their Supabase user id **or** **`email`** (non-empty) matching the login email (case-insensitive after trim).
2. **Assignment fields**: RLS and API treat a contact as assigned to a member when **`lower(trim(responsible))`** or **`lower(trim(assigned_agent))`** equals **`lower(trim(team_members.name))`**. If the admin UI shows an assignee but the DB value differs (extra spaces, spelling), fix the contact or rename the member (team update can cascade `responsible` in some flows).
3. **Apply migrations**: Policies in `20260424120000_collaborator_rls_align.sql` replace stricter older rules; run `supabase db push` / migrate on the target project.
4. **`20260424183000_team_members_collaborator_read.sql`**: `requireRouteUser` resolves the workspace by querying `team_members` with the **user JWT** first. Without this migration, missing `SUPABASE_SERVICE_ROLE_KEY` on the host made resolution fail silently (`workspaceUserId` stayed the collaborator’s own uid → **zero rows** for contacts/tasks). After push, collaborators can read team rows for their workspace without service role on every request.