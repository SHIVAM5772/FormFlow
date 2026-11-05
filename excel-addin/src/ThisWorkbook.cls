Attribute VB_Name = "ThisWorkbook"
Attribute VB_Base = "0{00020819-0000-0000-C000-000000000046}"
Attribute VB_GlobalNameSpace = False
Attribute VB_Creatable = False
Attribute VB_PredeclaredId = True
Attribute VB_Exposed = True
Option Explicit

Private Sub Workbook_Open()
    FormFlowEnable
End Sub

Private Sub Workbook_Activate()
    FormFlowEnable
End Sub

Private Sub Workbook_SheetSelectionChange(ByVal Sh As Object, ByVal Target As Range)
    FormFlowRememberCell Target
End Sub

Private Sub Workbook_SheetChange(ByVal Sh As Object, ByVal Target As Range)
    FormFlowHandleChange Target
End Sub

Private Sub Workbook_SheetBeforeDoubleClick(ByVal Sh As Object, ByVal Target As Range, Cancel As Boolean)
    Dim source As Range
    Set source = FormFlowChoiceSource(Target)
    If source Is Nothing Then Exit Sub
    Cancel = True
    FormFlowShowForCell Target
End Sub
