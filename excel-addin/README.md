# FormFlow same-cell multi-select add-in

For Windows desktop Excel. The add-in keeps macros in a separate `.xlam`; response workbooks stay `.xlsx` and work with the existing FormFlow upload. Excel Web cannot run this VBA add-in.

## Build once in Excel

1. Open a **new blank workbook** in desktop Excel. Press **Alt+F11** to open the VBA editor. Select this new workbook in Project Explorer (Ctrl+R).
2. Choose **File > Import File** (Ctrl+M). Import `src/CFormFlowEvents.cls`, then import `src/FormFlowMultiSelect.bas`. Import the files as components, rather than pasting their export headers into a worksheet module.
3. Choose **Debug > Compile VBAProject**. Return to Excel with Alt+F11.
4. Choose **Save As > Excel Add-In (\*.xlam)** and save as `FormFlowMultiSelect.xlam`. Do not save macros into a response template.
5. In **File > Options > Add-ins**, select **Manage: Excel Add-ins > Go > Browse**. Select the add-in you just built, tick it and click OK. Follow your organization's existing macro policy; do not enable all macros or change VBA project access settings. If policy blocks add-ins, use the manual semicolon format instead.

If programmatic VBA project access is already permitted, `powershell -File ./build.ps1` can build the same file in `dist/`. It fails with manual instructions when access is restricted and never changes security settings. Existing output files are not overwritten.

## Fill a response

Download a **new template** from the locally updated FormFlow app. Earlier templates do not contain the add-in's `FormFlowMulti_` markers.

- Select a checkbox response cell on **Responses**, starting at row 2. **Double-click** it for the tick menu. Click each option to toggle its check mark, then **Apply selections**. The menu reopens after each option click so you can select more.
- Alternatively, select options one at a time from the cell's normal dropdown. Each choice adds/removes that label in the same cell. Typing a single allowed label also toggles it; use Delete to empty the cell first if you want to replace everything.
- **Clear selections** clears the tick list; **Apply selections** commits it. **Cancel**, Esc, or clicking away discards changes made in the tick menu.
- For example, the cell stores `Mathematics; Science; English`. Labels must match the form exactly. Custom Other answers use `Other: your text` and are preserved by the tick menu.
- Checkbox grids use one such cell per grid row. Ordinary single-choice dropdowns remain single-choice. Multi-cell pastes are kept as pasted; they do not toggle selections.
- Save the response workbook as **`.xlsx`** and upload it as usual. Never upload `.xlam` or `.xlsm`. The server still validates the actual answers, including required fields and choice limits.

Without the add-in, enter `Mathematics; Science; English` directly. Native `.xlsx` data validation alone cannot provide a checkbox menu; the add-in must be loaded for it to work. Lists whose option labels contain semicolons are excluded from add-in support.

## Remove

Untick FormFlowMultiSelect in Excel Add-ins and restart Excel. Your `.xlsx` responses remain normal text and can still be uploaded.

## Verification

The repository tests verify generated named lists, checkbox/grid markers, combined answer round trips, and single-choice validation. Compile the VBA project and check this sequence in desktop Excel before distributing the add-in:

1. Select Mathematics, Science and English; apply and check all three are in one cell.
2. Reopen the menu, untick Science and apply; only Mathematics and English remain.
3. Make a menu change and cancel; the cell must remain unchanged.
4. Clear selections and apply; the cell must become empty.
5. Verify a normal single-choice dropdown still replaces its value, then save `.xlsx` and upload for preview.

The development machine blocks programmatic VBA access and its UI automation runtime is unavailable, so this source package has not yet been compiled or interactively verified in Excel. No prebuilt `.xlam` is included.
