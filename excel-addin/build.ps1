param([string]$OutputPath = (Join-Path $PSScriptRoot 'dist\FormFlowMultiSelect.xlam'))
$ErrorActionPreference = 'Stop'
$excel = $null
$book = $null
try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $book = $excel.Workbooks.Add()
    try { $project = $book.VBProject } catch { $project = $null }
    if ($null -eq $project) {
        throw 'Excel does not allow programmatic VBA project access. No security settings were changed. Follow the manual build steps in README.md instead.'
    }
    $null = $project.VBComponents.Import((Join-Path $PSScriptRoot 'src\CFormFlowEvents.cls'))
    $null = $project.VBComponents.Import((Join-Path $PSScriptRoot 'src\FormFlowMultiSelect.bas'))
    $resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
    if (Test-Path -LiteralPath $resolvedOutput) { throw "Output already exists: $resolvedOutput" }
    $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resolvedOutput)
    $book.IsAddin = $true
    $book.SaveAs($resolvedOutput, 55)
    Write-Output "Built: $resolvedOutput"
} finally {
    if ($null -ne $book) { $book.Close($false); $null = [Runtime.InteropServices.Marshal]::ReleaseComObject($book) }
    if ($null -ne $excel) { $excel.Quit(); $null = [Runtime.InteropServices.Marshal]::ReleaseComObject($excel) }
}
