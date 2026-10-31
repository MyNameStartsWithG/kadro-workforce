# ACME ENGINEERING — Kadro Workforce Management

A local application that runs a company's field workforce: employees, crews, projects and housing,
half-monthly timesheets and payroll, payments and the cash book, plus the company folder structure
(incoming documents are read and filed in the right folder).

Everything runs **on this computer**. Documents do not go to any cloud.
Two exceptions, both optional: if the AI layer is switched on, a document being classified is sent to Claude;
voice commands send the audio and the sentence to the assistant server.

---

## Installation

1. **Node.js** must be installed — download and install the "LTS" version from [nodejs.org](https://nodejs.org).
2. Copy the project folder to the client's computer.
3. Double-click **`start.bat`**.

On the first run the required packages are installed automatically (a few minutes, needs internet).
After that it starts straight away and the browser opens by itself:
`http://localhost:4360`

To close it, just close the black command window.

### Single file, no installation (KADRO.exe)

To send it to a computer without Node.js:

```
npm install
npm run build
```

This produces `dist/KADRO.exe`. Node.js, the server and the UI are inside the exe;
the other side just double-clicks it. The packaged version writes its data to the **Documents\KADRO** folder,
not next to the exe (no data is lost even if the exe is opened from Downloads or from inside a zip).

**Shipping it with data:** first take the data with Settings → Download backup, then:

```
node build.mjs --seed "Kadro backup.json" --out dist/client
```

The data is embedded in the exe. When the exe is opened on the other computer **for the first time** and there are no records there,
the data is loaded once, the folder structure is built and the timesheet and cash Excel files are written. If that computer already has records,
nothing is touched; if the backup file is also put in the zip, it can be opened by hand with Settings → Restore from backup.
A backup that contains an API key is never embedded.

**Client package with the voice key embedded** (no sample data):

```
node build.mjs --assistant-key <key.txt>
```

Ship `dist/KADRO.exe` with `dist/README.txt` (the update steps).
The client replaces the old exe; their records stay in `Documents\KADRO`, and the new version takes an automatic backup on first start.

---

## The first 5 minutes

| Step | What to do | Where |
|------|-----------|--------|
| 1 | **Settings** → check the document root (it can be a network drive) | Settings |
| 2 | **Build Folders on Disk** — all main sections and their subfolders are created | Dashboard |
| 3 | Enter the employee rows — each row creates a 15-folder personnel file automatically | Employees |
| 4 | Enter vehicles, projects and clients | the matching pages |
| 5 | Drag and drop a document and confirm the suggestion | Upload Documents |

---

## Pages

### Dashboard
Counts, **deadline warnings** and the button that builds the folders.
Work permits, residence permits, passports, vehicle inspections and insurance policies are listed here
as they approach their end date — overdue ones in red.

### Forecast
**General → Forecast** in the menu. The columns are 15-day periods and the table scrolls left and right.
The **‹‹ 3 months / Today / 3 months ››** buttons move the table. Grey columns are **actual**, columns with an orange header are **estimates**.
The current period has an underlined header.

| Row | Actual | Estimate |
|---|---|---|
| Salaries | Timesheet earnings (excluding overtime) | Current pay of the employees. Monthly: half the salary. Hourly: workdays × normal hours × rate |
| Overtime | Overtime pay in the timesheet | The person's average overtime over the last 4 closed periods |
| Meals | Days worked in the timesheet | Crew meal amount × people in the crew × workdays |
| House rents | Rent in the cash book | The houses' rent, in the first half of the month |
| Other expenses / Income | Cash book | Future-dated rows in the cash book and rows marked "repeats monthly" |
| Cash balance | The balance in the cash book | Previous balance + estimated net |

- The **project filter** shows only that project's costs. The **EUR / TRY / RSD** tabs choose the currency.
- **Click a cell** to list where the amount comes from below: which person, crew, house or cash row.
- **Correcting an estimate:** type an amount into the estimate cell and press Enter (1,500 or 1500.50 both work). The cell turns yellow.
  Empty the cell or press "Back to the system's figure" in the detail to go back to the system's estimate.
  A correction applies to the project view it was made in.
- When pay, crew or house details change, the estimates update at once. Actual periods do not change.
- **Export to Excel:** each currency comes as a separate sheet. Cells corrected by hand are yellow and their note shows the system's figure.

### Folder Tree
What is **really** on disk. The number next to a folder is how many files it holds.
Select a folder to see its description, its rule, its full path and the files in it.
"Open folder" opens it in Windows Explorer.

**Deleting a document uploaded by mistake:** the **Delete** button on the file's row. The file is not deleted for good;
it is moved to the **_Deleted** folder at the top of the tree in its original folder structure, and the Document Register's "Status" column
gets "Deleted (date, user)".
- In _Deleted each file has **Restore** (puts it back where it was) and **Delete forever** (removes it from disk; cannot be undone).
- A file that is open in Excel or another program cannot be deleted; close the program and try again.

### Upload Documents
Drag and drop the file. The system suggests a target; **nothing is moved** until you confirm.
- If you don't like the target, change it from the drop-down list.
- The suggested file name can be edited too (payslips, invoices and the like get a `YEAR-MONTH` prefix).
- On confirmation the file is moved into the real folder and logged in the **Document Register**.

### Tables — Employees, Equipment, Vehicles, Projects, Clients
They work like Excel: click a cell and type; click elsewhere to save.

- **Export to Excel** → a formatted `.xlsx` downloads (frozen header, filters, drop-down lists).
- **Import from Excel** → edit the same file in Excel and upload it back.
  Rows whose employee code / plate matches are **updated**, new ones are **added**.
- When a new row is added, its folder on disk is created from the template automatically.
- If you rename a record, its folder on disk is renamed too.
- Deleting a record **does not delete its folder on disk** — the documents stay where they are.

### Crews, Houses and detail pages
- Houses have a **Rent Period** (Monthly / Weekly / Daily). "Rent per Person (monthly)" and "Rent per Person Daily" are calculated by themselves.
Links work like this: an employee is assigned to a **crew**, a crew to a **project**. Abroad, an employee is assigned to a **house**.
All links are kept by code, so they do not break when a name changes.

- The **↗** mark at the start of a row opens the record's detail page. Employees, crews, projects and houses have a detail page.
  The details can be edited on that page too.
- **Crew page:** add and remove members, issue equipment to the crew. The meal amount is entered per person per day;
  the crew total (daily and per 15 days) is calculated automatically.
- **House page:** move people in and out, track occupancy (warns when the number of beds is exceeded).
  The rent is split per person and charged to each person's project.
- **Project page:** linked crews, people, equipment and houses on one page, with a meals, rent and salary summary.
- **Equipment** is issued either to a crew or to a person (Owner Type). A crew with open equipment cannot be deleted.
- **Pay:** employees have Pay Type (Monthly/Hourly), Pay and Currency fields.
  Every change is written with its date to the employee's **Pay History**.
- **Employee's view:** the button at the top right of the employee page opens the page the employee would see:
  - their crew, project, the house they live in, their rent share and daily meal allowance;
  - the timesheet of the chosen dates day by day; days absent in red. From the bar at the top, **at most two periods**
    are chosen (clicking a period chip adds it to or removes it from the selection; clicking a third drops the one furthest from it) or
    two days are entered in **Date range** (e.g. 03/10 – 20/11). If the range covers more than two periods the last two are shown
    and the bar shows a warning. There are **This month** and **Last 2 periods** shortcuts.
    Days worked, total / normal / overtime hours, and absent, leave and sick counts of the chosen days are totalled at the top;
  - the earnings calculation line by line (for every chosen period, for the whole period): half the salary / hours worked, overtime,
    each deduction with its formula, advances, net; in the 2nd half of the month "What you receive at month end" (no separate big figure box);
  - **Your payments · meal allowance:** only the meal allowance items of the chosen month (paid / pending); salary payments are not listed;
  - employment periods (contracts) and the expiry dates of their documents (work permit, residence permit, passport).

  Manager notes, IBAN, phone, cash and other employees' information never appear on this page.
  **Print / PDF** prints: name, code, crew and project, the timesheet (day grid and hour totals), the earnings calculation and that month's
  meal allowance payments. Pay, house, employment periods and documents are not in the PDF.
  "Timesheet and earnings <name> <first day>_<last day>" is suggested as the PDF file name.
  An employee portal will show this page later.
- **Notes panel:** on the employee page, under the Details card. Type a note title and the note and press **Save**;
  each note is saved separately. Below, the titles and dates of saved notes are listed (most recently changed first).
  Click a title to open the note; **✎** on the right loads it into the form for editing, **✕** asks for confirmation and deletes it.
  If the title is left empty, the first line of the note becomes the title. Notes are for the manager only: they never reach the employee page, voice commands or Excel.
  The old one-line "Notes" field of the employee was moved once into this panel as "General note" on first start and removed from the table.
- **Insurance Start:** a date field next to Start Date on the employee. It shows in the table, on the person page and in Excel.
- **Employment Periods (contracts):** the dates and project a person works on. Entered from the **Employment Periods** card on the person page
  or from the **Employment Periods** table in the menu.
  - Type **Work**: the start is required; if **End (leaving date)** is empty it is open-ended. The leaving date can be entered in advance
    (the card has an **Enter leaving date** button next to an open-ended period). When the project changes, end the previous period one day before
    and open a new period for the new project; the same person's employment periods cannot overlap.
  - Type **Leave**: long leave (e.g. going home). It only makes the status On leave; it does not change the pay calculation.
  - For a person with employment periods, the **status is calculated by itself for today** (Active / On leave / Left) and is
    locked on the Details card. A future hire shows as Active until they start. Once the leaving day has passed the person becomes Left.
  - **Timesheet:** when a new period is opened, the person is included if an employment period overlaps those 15 days. Days outside the employment period
    are hatched and are not counted anywhere (hours, salary share, meals, rent, deductions). A monthly employee working part of the period
    gets daily salary × days. Dates apply to open periods at once; closed periods stay as they were closed.
    Not applied in periods with the old rule (rule 1).
  - **Forecast:** in the estimate a person is counted only for the days inside their employment period (salary, overtime and meals).
  - **Warning:** an employment period 30 days from its end is listed in the Dashboard's deadline warnings and links to the person's page.
    If a follow-on period has been entered there is no warning.
  - For a person without employment periods everything works as before, from the status entered by hand.

### Timesheets
The month is split into two periods: **1–15** and **16–end of month**. Use the ‹ › arrows at the top to move between periods.

- **Open period:** each person's pay, crew, the crews' meal amounts and the house rent shares as of that day are copied into the period.
  Pay changes made on the employee card after that do not affect this period.
- **Cells:** type hours (8, 10.5). Letter codes: `L` leave, `S` sick, `–` absent.
  Move between cells with Enter and the arrow keys. A block copied from Excel can be pasted straight in.
- **Clicking a day header:** changes the day type: Normal / Overtime day / Holiday. By default Saturday is an overtime day and Sunday a holiday.
  The same menu offers "write 8 in empty cells", "copy the previous day" and "clear the column".
- **Right-clicking a cell:** pick a code and change that day's crew (for a person who moves to another crew mid-period).
  Days spent in another crew show an orange mark in the corner.
- **Row menu (⋯):** fill empty normal days, change the crew for a date range, clear the row and remove from the period.
- **Side panel (the "Panel" tab on the right):**
  - Statistics. Click a value to add it to the calculator.
  - Overtime settings: overtime calculation (fixed hourly rate or multiplier), overtime rate per currency (EUR / TRY / RSD),
    normal-day hours, weekday excess and holiday rules, deducting short hours for monthly staff.
  - Calculator.
- **Calculation (periods opened from October 2026 on):**
  - **Overtime:** overtime hours × fixed hourly overtime rate. The rate is the panel rate for the currency; if an "Overtime Rate"
    is entered on the employee card, that is used for that person. The rate is carried over from the previous period when a period is opened.
  - Hourly worker: normal hours × rate + overtime.
  - Monthly worker: half the salary + overtime. If they started during the period: daily salary × days since the start date.
  - **Deductions only on days marked `–` (absent):**

    | Worker | Deducted for each day absent |
    |---|---|
    | Monthly | daily salary (salary × 12 ÷ 365) + daily rent share + daily meals |
    | Hourly | daily rent share + daily meals (hours not worked are not paid anyway) |

    Empty cells, leave (`L`), sick (`S`) and days before the start date cause no deduction. Days before the start date are hatched.
    Daily rent share = house rent × F ÷ 365 ÷ people living in the house (F: monthly rent 12, weekly 52, daily 365).
  - **Different currency:** if rent, meals or an advance are in a currency other than the salary's, they are converted to the salary's
    currency at the period's rates and deducted (e.g. 600 RSD meals ÷ 117 = 5.13 EUR). The rates come from Settings (see "Currency and rates" below).
    If no rate is entered for that currency it is not deducted and the row shows a warning.
  - **Deduction breakdown:** click the deduction figure to open the formula item by item. Example (monthly 1000 EUR, rent 550 EUR / 3 people, meals 600 RSD, absent 1 day):

    | Item | Formula | Amount |
    |---|---|---|
    | Daily salary | 1 day × 1,000 EUR × 12 ÷ 365 | 32.88 EUR |
    | Rent share | 1 day × 550 EUR × 12 ÷ 365 ÷ 3 people | 6.03 EUR |
    | Meals | 1 day × 600 RSD ÷ 117 | 5.13 EUR |
    | **Total** | | **44.04 EUR** |

    The same breakdown appears in the "Absence and Deductions" table on the person card and in the timesheet Excel (as a note on the Deduction cell).
    The daily salary is divided by 365 ÷ 12, not by 30: 12 × 30 = 360 days, which would leave 5 days of the year out.
  - Net = earnings − deductions − advances. In the 2nd half the "Due at Month End" column adds up the net of both periods.
  - **Older periods** keep the old rule. Opened before October 2026: overtime by multiplier, deductions as short hours × hourly value.
    Opened before 13 October 2026: no currency conversion (deductions and advances in another currency are not deducted).
    An open older period can be moved to the new calculation with the "Move to the new rules" button in the panel.
  - The panel shows the period's rates. If the rates change in Settings, an open period gets a "Use the current rates" button; a closed period does not change.
- **Close period:** the cells are locked and the Excel file is written to the `02 - Accounting/Payroll/Timesheets/` folder.
  Salaries do not go into the cash book by themselves; they show as "pending" on the **Payments** page.

### Advances and Employee Statistics
- In the **Advances** table enter the date, person and amount. The advance shows in the matching timesheet period by its date
  and is written to the cash book as an expense at the same time.
- **Employee Statistics** totals every period by person and by project. In the project view, each day's hours and amounts
  go to the project of the crew the person worked in that day. The "Work Summary" on the person card shows them period by period.
- The **"Absence and Deductions"** card on the person card is the person's loss statistic: how many days they were absent (with dates),
  and the daily salary, rent share and meals deducted from their pay; per period and in total.

### Payments
**Timesheets, Pay and Cash → Payments** in the menu. It opens month by month; the number of due, unpaid items shows as a red counter in the menu.

| Item | When it is listed | Due |
|---|---|---|
| House rents | When the 1st half of the month is opened | The 1st of the month |
| Meal allowances (per person, in advance) | When each period is opened | The first day of the period (the 1st and the 16th) |
| Hourly wages | When the period is closed | The day after the period (the 16th and the 1st of the next month) |
| Monthly salaries | When the 2nd half of the month is closed | The 1st of the next month |

- Ticking the box on a row marks the item **paid** and puts it in the cash book as an expense on the payment date.
  The payment date is chosen at the top of the group.
- **The amount paid can be changed:** e.g. if 90 € or 110 € was paid instead of the calculated 100 €, type it into the "Paid" box.
  The difference shows on the row and the amount paid goes into the cash book. A reason can go in the "Note" field (e.g. "in cash, rounded").
- **All paid:** the button at the top of a group marks every unpaid item in the group as paid in one go.
- Unticking removes the paid mark and the cash row.
- If the calculation changes after payment (e.g. the period was reopened and hours corrected), the row shows a "calculation changed" warning.
- The small text under a row is the breakdown of the figure: earnings, overtime, deductions (days absent), advances.

### Cash
**Timesheets, Pay and Cash → Cash** in the menu. The page opens month by month; use the ‹ › arrows to move between months.

- **Summary:** carried over (left from earlier months), income, expense and month-end balance. No currency conversion is done; EUR, TRY and RSD are on separate rows.
- **+ Income / + Expense:** add a row by hand. Rows are edited like Excel and saved when you click elsewhere.
  The "Repeats Monthly" mark is for fixed expenses other than rent (the forecast uses them).
- **Automatic rows** (light orange background, labelled "Automatic"). The system writes these:

  | Source | When | Date | Project |
  |---|---|---|---|
  | Advance | When an advance is entered, changed or deleted | The advance's date | The project of the person's crew on that day |
  | Payment (salary, meals, rent) | When marked "paid" on the Payments page | The payment date | The person's project; rent is split over the projects of the residents |

  A salary payment is the amount after advances. Since advances are separate rows, the total equals the earnings.
- **Correcting by hand:** if the amount, date, project etc. of an automatic row is changed, the row becomes "Corrected by hand" and
  the system never overwrites it. The "System Amount" column keeps showing the figure the system found.
  Clicking the "Corrected by hand" label removes the correction and the row goes back to the system's figure.
- **Deleting an automatic row:** the system never writes that row again. The "Bring back" button on the Cash page writes the month's deleted automatic rows back.
- **Monthly file:** `02 - Accounting/Cash/2026-10 Cash.xlsx` is updated by itself on every change to the cash book.
  If the file is open in Excel at that moment it cannot be updated. The Cash page shows a warning; it is written on the first change after the file is closed.
- **Reports tab:** 15 days, monthly, quarterly, half-yearly, yearly and by project. Each row has carry-over, income, expense, net and balance.
  Click a row to open that period's breakdown by category and by project below. There is also a project filter and "Export the report to Excel".

### Currency and rates (Settings)
- Choose the **base currency** (EUR by default) and type the value of the others by hand: `1 EUR = 117 RSD`, `1 EUR = 45 TRY`.
  Rates are not fetched from the internet. If the base currency is changed, the rates entered are rewritten against the new base by themselves.
- The rates are copied into a timesheet period **when it is opened**; rates changed later do not affect periods already opened
  (in an open period, refresh them from the panel with "Use the current rates").
- The **"≈ EUR"** row in Cash, Payments and the timesheet panel is the value of totals in several currencies in the base currency
  (for information). Cash rows stay in their own currency.

### Document Register
A record of every file taken into the system: when, into which folder, by which method,
with what confidence it was filed. It cannot be edited; it is read only and can be exported to Excel.
Deleted, restored and permanently deleted documents are noted with their date in the "Status" column.

### Voice commands
The orange **microphone** button at the bottom right of every page. Tap the microphone and speak, tap again when done
(or type in the box below). Examples:

> "Cem was absent today, Tolga worked 10 hours" · "I gave Mehmet a 100 euro advance" ·
> "I bought 60 euro of fuel" · "Cem's hourly wages for the 2nd half of September are paid" · "Move Tolga to the Novi Sad Electrical crew" ·
> "How much will Murat get this month?" · "Who was absent today?"

- **Nothing is written until you press Approve.** Each action comes as a card: who, which day, what changes
  (e.g. "8 hours → absent"). If several cards come there is also "Approve all".
- If a name is ambiguous ("Demir") the assistant asks which one; answer in the same conversation ("the one called Ahet").
  "New conversation" makes it forget the previous conversation.
- What it can do: timesheets (hours, leave, sick, absent), advances, income/expense in the cash book, marking a payment "paid",
  an employee's crew/house/role/status, and questions (timesheets, earnings, payments, cash, advances).
- What it cannot do: delete, change pay, open/close timesheet periods, write to a closed period, settings. These are done on screen.
- A crew or house change does not apply to the open timesheet period (each change only affects new periods); the card says so.
- The status of a person with employment periods cannot be changed by voice (it is calculated from the periods); the assistant says so.
- **Recent actions** (the bottom of the panel): every action written by voice, with the sentence spoken. **Undo** puts the record back as it was;
  if the record was changed by hand afterwards, undo stops and asks you to correct it by hand.
- Setup: the exe sent to the client comes with the key embedded; nothing to enter. If it is not embedded, enter the key under **Settings → Voice commands**
  (an entered key takes precedence over the embedded one). If the address is empty the default server
  (`https://n8n.example.com`) is used; if the server changes, type the new address in the address field. The audio and the sentence go to this server
  (n8n → transcription with Groq, understanding with DeepSeek). Employee names and the timesheet/advance/payment/cash information asked about
  go there; IBANs, phone numbers, passports and notes do not. The key is not included in backups.
- **Command log:** every command (the sentence spoken, the actions the assistant called and their results, time, tokens) and every card
  event (approve, cancel, undo, expiry) is written first to this computer (`data/assistant-log/<month>.jsonl`), then to the
  `kadro_log` table on the server (with the client's consent, to improve the assistant). Audio is not stored.
  Sending happens at most once every 15 minutes, in batches; without internet the records wait and go later.
- The microphone works on this computer (`localhost`). To use it from a phone the program has to be opened from an HTTPS address
  (browsers do not give the microphone to an unencrypted address).

---

## How the AI layer works

It has two stages:

**1. Rule engine** — matches keywords in the file name and the names / plates / project names
in the tables. Instant, free, no internet.

> `2026-03 Mehmet Kılıç Payslip.pdf`
> → `01 - Human Resources (HR)/Employees/KDR-2026-0001 Mehmet Kılıç/06 Payslips` (90%)

**2. Claude** — steps in when the rules are not sure enough and **reads the inside** of the document:
the pages of a PDF, scanned ID/passport images.
It takes the person, the date and the document type from the document.

### Modes (from the Settings page)

| Mode | Description |
|-----|----------|
| **Rules + AI** | Recommended. If the rules are not sure, Claude is asked. |
| **AI only** | Every document goes to Claude. The most accurate, the most expensive. |
| **Rules only** | Fully offline and free. No document leaves the computer. |

### API key
Get it at `console.anthropic.com` and enter it on the **Settings** page.
The key is stored on this computer in `data/db.json`. Model used: `claude-opus-5`.

Without a key the application **does not stop** — it keeps working with the rule engine only.

---

## File name suggestions

The system turns documents with a date into a standard form:

- Payslip, timesheet, receipt, invoice, statement, progress billing → `2026-03 ...` (year-month prefix)
- Other dated documents → `2026-03-14 ...`
- File names that already start with a date are left alone.

If a file with the same name exists it is not overwritten; ` (2)`, ` (3)` is appended.

---

## Changing the folder structure

The whole structure is defined in one file: **`src/structure.js`**

To add a folder, change a description or add a keyword,
edit that file, restart the application and press **Build Folders**.
Existing folders and documents are not touched; only the missing ones are created.

The same file has the templates:
- `EMPLOYEE_TEMPLATE` — the 15 folders created for each employee
- `PROJECT_TEMPLATE` — the 8 sections created for each project
- `VEHICLE_TEMPLATE` — the 6 sections created for each vehicle
- `CLIENT_TEMPLATE` — the 4 sections created for each client
- `HOUSE_TEMPLATE` — the sections created for each house

To change the table columns: **`src/tables.js`**
(Fields with `warnDays: 60` produce a warning 60 days before their date.)

---

## Backups

| What | Where |
|----|--------|
| All records (employees, crews, equipment, houses, timesheets, advances, cash, forecast, document register) | `data/db.json` — **a single file** |
| Documents | The document root folder in Settings |

With KADRO.exe these folders are under `Documents\KADRO`.

### Moving the data to another computer (Settings → Data and backup)
1. On the computer with the data, press **Download backup**. A single file named `Kadro backup 2026-10-09.json` downloads.
2. Send the file to the other side (e-mail, USB…).
3. On the other computer open KADRO.exe and choose the file with **Settings → Restore from backup…**.
   - The records on that computer are **replaced** with those in the backup. The old records are first saved in the `data/backups/` folder; if loaded by mistake, they can be restored from there.
   - The document root and the API key stay as they are on that computer. The API key is never written into the backup file.
   - A backup from an older version or a plain `db.json` can be loaded too. Missing fields are filled in during loading.
4. Documents (PDFs, photos) are not in the backup. Copy the document root folder separately if needed.

### Resetting the records (Settings → Reset records)
The **Delete all records…** button, to get rid of test records and start clean.
1. The first window shows what will be deleted, with counts. Optional: **Clear the documents folder too**.
2. In the second window type **DELETE** in the box; only then is the button enabled.

- Deleted: employees, crews, projects, houses, vehicles, clients, equipment, advances, timesheets, cash, forecast corrections, payments and the Document Register.
- Kept: settings (document root, rates, API key, user name).
- A backup is taken automatically before deleting: `data/backups/db-…-before-reset.json`. If deleted by mistake,
  choose this file with **Restore from backup…** and everything comes back.
- If "Clear the documents folder too" is ticked the documents are not deleted: the folder is set aside as `ACME ENGINEERING (old 2026-10-14)`
  and an empty folder structure is built in its place. If it is not ticked the documents stay as they are.
- After a reset the sample data embedded in the exe is never loaded again.

### A separate data folder for testing
KADRO.exe normally keeps its data under `Documents\KADRO`. To try things without touching the real data, start the exe
with the `KADRO_FOLDER` environment variable. In PowerShell:
```powershell
$env:KADRO_FOLDER = "C:\KADRO-test"; $env:PORT = "4370"; .\KADRO.exe
```

---

## Troubleshooting

**It says "Node.js is not installed"**
Install the LTS version from nodejs.org and run `start.bat` again.

**The browser does not open**
Go to `http://localhost:4360` by hand. The command window must be open.

**Port in use error**
Another copy may be running. Close the command windows or
add a `set PORT=4370` line to `start.bat`.

**Excel import does not work**
Use the file you downloaded from the system — the header row is needed to recognise the columns.
Do not change the header texts; adding rows and writing data is fine.

**The AI does not work**
Check that Settings says "on" and that there is internet.
If the problem persists, the application quietly falls back to the rule engine and keeps working.

---

## Technical summary

- Node.js + Express local server, listening on `127.0.0.1` (not open to the outside)
- Data: a single JSON file — no database server needed
- Excel: real `.xlsx` writing and reading with ExcelJS
- AI: Anthropic SDK, `claude-opus-5`, with PDF and image input
- Attempts to write outside the document root are rejected
