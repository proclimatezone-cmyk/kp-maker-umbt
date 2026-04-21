On Error Resume Next
      Set w = CreateObject("Word.Application")
      If Err.Number <> 0 Then
        WScript.Echo "ERROR: Word COM Object could not be created: " & Err.Description
        WScript.Quit 1
      End If
      w.Visible = False
      Set d = w.Documents.Open("C:\\MN og\\devs\\kp maker for umbt\\qa_test_result.docx")
      If Err.Number <> 0 Then
        WScript.Echo "ERROR: Could not open document: " & Err.Description
        w.Quit
        WScript.Quit 1
      End If
      d.ExportAsFixedFormat "C:\\MN og\\devs\\kp maker for umbt\\qa_test_result.pdf", 17
      If Err.Number <> 0 Then
        WScript.Echo "ERROR: ExportAsFixedFormat failed: " & Err.Description
      End If
      d.Close 0
      w.Quit