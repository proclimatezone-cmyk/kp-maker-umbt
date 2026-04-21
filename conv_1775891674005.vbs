Set objWord = CreateObject("Word.Application")
objWord.Visible = False
Set objDoc = objWord.Documents.Open("C:\\MN og\\devs\\kp maker for umbt\\gen_1775891674005.docx")
objDoc.SaveAs "C:\\MN og\\devs\\kp maker for umbt\\gen_1775891674005.pdf", 17
objDoc.Close 0
objWord.Quit