Attribute VB_Name = "FormFlowMultiSelect"
Option Explicit

Private hooks As CFormFlowEvents
Private remembered As Range
Private rememberedText As String
Private writing As Boolean
Private showing As Boolean
Private targetCell As Range
Private choices() As String
Private checked() As Boolean
Private remainingText As String
Private popup As Object
Private finished As Boolean
Private applyRequested As Boolean
Private menuAction As Boolean

Public Sub Auto_Open()
    FormFlowEnable
End Sub

Public Sub Auto_Close()
    Set hooks = Nothing
    Set remembered = Nothing
End Sub

Public Sub FormFlowEnable()
    Set hooks = New CFormFlowEvents
    Set hooks.App = Application
    ' Add-ins can load before any workbook window exists.
    On Error Resume Next
    If TypeName(Application.Selection) = "Range" Then FormFlowRememberCell Application.Selection
    On Error GoTo 0
End Sub

Public Function FormFlowChoiceSource(ByVal cell As Range) As Range
    On Error GoTo NotApplicable
    If cell Is Nothing Then Exit Function
    ' Embedded XLSM workbooks handle their own events; avoid toggling twice.
    If ThisWorkbook.IsAddin And LCase$(Right$(cell.Worksheet.Parent.Name, 5)) <> ".xlsx" Then Exit Function
    If cell.Cells.CountLarge <> 1 Then Exit Function
    If cell.Worksheet.Name <> "Responses" Or cell.Row < 2 Then Exit Function
    If cell.Validation.Type <> xlValidateList Then Exit Function
    Dim listName As String
    listName = cell.Validation.Formula1
    If Left$(listName, 1) = "=" Then listName = Mid$(listName, 2)
    If Left$(listName, 14) <> "FormFlowMulti_" Then Exit Function
    Dim mapping As Worksheet
    Set mapping = cell.Worksheet.Parent.Worksheets("Field Mapping")
    If CStr(mapping.Cells(1, 1).Value2) <> "Template ID" Then Exit Function
    If CStr(mapping.Cells(cell.Column + 3, 2).Value2) <> CStr(cell.Worksheet.Cells(1, cell.Column).Value2) Then Exit Function
    Dim kind As String
    kind = CStr(mapping.Cells(cell.Column + 3, 5).Value2)
    If kind <> "CHECKBOXES" And kind <> "CHECKBOX_GRID" Then Exit Function
    Dim source As Range
    Set source = cell.Worksheet.Parent.Names(listName).RefersToRange
    If Not (source.Worksheet.Parent Is cell.Worksheet.Parent) Then Exit Function
    If source.Worksheet.Name <> "Validation Reference" Then Exit Function
    If source.Areas.Count <> 1 Or source.Columns.Count <> 1 Then Exit Function
    If source.Cells.CountLarge < 1 Or source.Cells.CountLarge > 10000 Then Exit Function
    Dim item As Range
    For Each item In source.Cells
        If item.HasFormula Or InStr(1, CStr(item.Value2), ";", vbBinaryCompare) > 0 Then Exit Function
    Next item
    Set FormFlowChoiceSource = source
NotApplicable:
End Function

Public Sub FormFlowRememberCell(ByVal cell As Range)
    On Error GoTo ResetCell
    If writing Or showing Then Exit Sub
    Dim source As Range
    Set source = FormFlowChoiceSource(cell)
    If source Is Nothing Then GoTo ResetCell
    Set remembered = cell
    rememberedText = CStr(cell.Value2)
    Exit Sub
ResetCell:
    Set remembered = Nothing
    rememberedText = ""
End Sub

Public Function FormFlowToggleText(ByVal oldText As String, ByVal optionText As String) As String
    Dim parts As Variant, part As Variant, result As String, found As Boolean
    parts = Split(oldText, ";")
    For Each part In parts
        Dim value As String
        value = Trim$(CStr(part))
        If StrComp(value, optionText, vbBinaryCompare) = 0 Then
            found = True
        ElseIf Len(value) > 0 Then
            If Len(result) > 0 Then result = result & "; "
            result = result & value
        End If
    Next part
    If Not found Then
        If Len(result) > 0 Then result = result & "; "
        result = result & optionText
    End If
    FormFlowToggleText = result
End Function

Public Sub FormFlowHandleChange(ByVal cell As Range)
    On Error GoTo Done
    If writing Or showing Then Exit Sub
    Dim source As Range
    Set source = FormFlowChoiceSource(cell)
    If source Is Nothing Then
        Set remembered = Nothing
        Exit Sub
    End If
    Dim incoming As String, isOption As Boolean, item As Range
    incoming = CStr(cell.Value2)
    If remembered Is Nothing Then GoTo RememberNew
    If Not (remembered.Worksheet Is cell.Worksheet) Then GoTo RememberNew
    If remembered.Address <> cell.Address Then GoTo RememberNew
    For Each item In source.Cells
        If StrComp(incoming, CStr(item.Value2), vbBinaryCompare) = 0 Then isOption = True
    Next item
    If isOption Then FormFlowWrite cell, FormFlowToggleText(rememberedText, incoming)
RememberNew:
    Set remembered = cell
    rememberedText = CStr(cell.Value2)
Done:
End Sub

Public Sub FormFlowWrite(ByVal cell As Range, ByVal text As String)
    Dim wasEnabled As Boolean
    wasEnabled = Application.EnableEvents
    On Error GoTo RestoreEvents
    writing = True
    Application.EnableEvents = False
    cell.Value2 = text
RestoreEvents:
    Application.EnableEvents = wasEnabled
    writing = False
End Sub

Public Sub FormFlowShowMultiSelect()
    If TypeName(Application.Selection) <> "Range" Then Exit Sub
    FormFlowShowForCell Application.Selection
End Sub

Public Sub FormFlowShowForCell(ByVal cell As Range)
    On Error GoTo Cleanup
    If showing Then Exit Sub
    Dim source As Range
    Set source = FormFlowChoiceSource(cell)
    If source Is Nothing Then Exit Sub
    showing = True
    Set targetCell = cell
    Dim count As Long, i As Long, item As Range, part As Variant
    count = source.Cells.Count
    ReDim choices(0 To count - 1)
    ReDim checked(0 To count - 1)
    i = 0
    For Each item In source.Cells
        choices(i) = CStr(item.Value2)
        i = i + 1
    Next item
    remainingText = ""
    For Each part In Split(CStr(cell.Value2), ";")
        Dim matched As Boolean, value As String
        value = Trim$(CStr(part))
        matched = False
        For i = 0 To count - 1
            If StrComp(value, choices(i), vbBinaryCompare) = 0 Then checked(i) = True: matched = True
        Next i
        ' Preserve custom Other answers and unrecognized values for server-side validation.
        If Not matched And Len(value) > 0 Then
            If Len(remainingText) > 0 Then remainingText = remainingText & "; "
            remainingText = remainingText & value
        End If
    Next part
    finished = False
    applyRequested = False
    Dim leftPixel As Long, topPixel As Long
    leftPixel = ActiveWindow.PointsToScreenPixelsX(cell.Left)
    topPixel = ActiveWindow.PointsToScreenPixelsY(cell.Top + cell.Height)
    Do
        Set popup = Application.CommandBars.Add(Position:=5, Temporary:=True)
        Dim button As Object
        For i = 0 To count - 1
            Set button = popup.Controls.Add(Type:=1)
            button.Caption = Replace(Left$(choices(i), 230), "&", "&&")
            button.TooltipText = Left$(choices(i), 250)
            button.Style = 2
            button.State = IIf(checked(i), -1, 0)
            button.Tag = CStr(i)
            button.OnAction = "'" & Replace(ThisWorkbook.Name, "'", "''") & "'!FormFlowToggleChoice"
        Next i
        Set button = popup.Controls.Add(Type:=1)
        button.BeginGroup = True
        button.Caption = "Apply selections"
        button.OnAction = "'" & Replace(ThisWorkbook.Name, "'", "''") & "'!FormFlowApplyChoices"
        Set button = popup.Controls.Add(Type:=1)
        button.Caption = "Clear selections"
        button.OnAction = "'" & Replace(ThisWorkbook.Name, "'", "''") & "'!FormFlowClearChoices"
        Set button = popup.Controls.Add(Type:=1)
        button.Caption = "Cancel"
        button.OnAction = "'" & Replace(ThisWorkbook.Name, "'", "''") & "'!FormFlowCancelChoices"
        menuAction = False
        popup.ShowPopup leftPixel, topPixel
        popup.Delete
        Set popup = Nothing
        If Not menuAction Then Exit Do
    Loop Until finished
    If applyRequested Then FormFlowWrite targetCell, FormFlowSelectedText()
Cleanup:
    On Error Resume Next
    If Not popup Is Nothing Then popup.Delete
    Set popup = Nothing
    Set targetCell = Nothing
    showing = False
    If Not cell Is Nothing Then FormFlowRememberCell cell
End Sub

Private Function FormFlowSelectedText() As String
    Dim i As Long, result As String
    For i = LBound(choices) To UBound(choices)
        If checked(i) Then
            If Len(result) > 0 Then result = result & "; "
            result = result & choices(i)
        End If
    Next i
    If Len(remainingText) > 0 Then
        If Len(result) > 0 Then result = result & "; "
        result = result & remainingText
    End If
    FormFlowSelectedText = result
End Function

Public Sub FormFlowToggleChoice()
    If Not showing Then Exit Sub
    Dim index As Long
    index = CLng(Application.CommandBars.ActionControl.Tag)
    If index < LBound(checked) Or index > UBound(checked) Then Exit Sub
    checked(index) = Not checked(index)
    menuAction = True
End Sub

Public Sub FormFlowApplyChoices()
    menuAction = True
    finished = True
    applyRequested = True
End Sub

Public Sub FormFlowCancelChoices()
    menuAction = True
    finished = True
End Sub

Public Sub FormFlowClearChoices()
    Dim i As Long
    For i = LBound(checked) To UBound(checked)
        checked(i) = False
    Next i
    remainingText = ""
    menuAction = True
End Sub
