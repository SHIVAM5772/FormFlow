VERSION 1.0 CLASS
BEGIN
  MultiUse = -1
END
Attribute VB_Name = "CFormFlowEvents"
Attribute VB_GlobalNameSpace = False
Attribute VB_Creatable = False
Attribute VB_PredeclaredId = False
Attribute VB_Exposed = False
Option Explicit

Public WithEvents App As Excel.Application

Private Sub App_SheetSelectionChange(ByVal Sh As Object, ByVal Target As Range)
    FormFlowRememberCell Target
End Sub

Private Sub App_SheetChange(ByVal Sh As Object, ByVal Target As Range)
    FormFlowHandleChange Target
End Sub

Private Sub App_SheetBeforeDoubleClick(ByVal Sh As Object, ByVal Target As Range, Cancel As Boolean)
    Dim source As Range
    Set source = FormFlowChoiceSource(Target)
    If source Is Nothing Then Exit Sub
    Cancel = True
    FormFlowShowForCell Target
End Sub
