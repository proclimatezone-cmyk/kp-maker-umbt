"""Замена текста в .docx, разорванного Word на куски.

Word режет текст на фрагменты <w:t> по истории правок, поэтому искать
подстроку в готовом XML бесполезно. Здесь текст абзаца склеивается,
подстрока ищется в склейке, а замена целиком кладётся в первый
задетый фрагмент — остальные задетые очищаются. Так сохраняется
оформление начала строки, а метка не оказывается разорванной.
"""
import re

T_RE = re.compile(r'(<w:t[^>]*>)([^<]*)(</w:t>)')

def _open_preserving(tag: str) -> str:
    return tag if 'xml:space' in tag else tag.replace('<w:t', '<w:t xml:space="preserve"', 1)

def replace_in_paragraph(para: str, target: str, replacement: str) -> tuple[str, bool]:
    nodes = list(T_RE.finditer(para))
    if not nodes:
        return para, False
    joined = "".join(n.group(2) for n in nodes)
    at = joined.find(target)
    if at == -1:
        return para, False

    end = at + len(target)
    out, cursor, pos = [], 0, 0
    placed = False
    for n in nodes:
        text = n.group(2)
        start, stop = pos, pos + len(text)
        pos = stop
        out.append(para[cursor:n.start()])
        cursor = n.end()

        if stop <= at or start >= end:          # фрагмент не задет
            out.append(n.group(0))
            continue

        head = text[:max(0, at - start)]
        tail = text[max(0, end - start):] if stop > end else ""
        if not placed:
            new = head + replacement + tail
            placed = True
        else:
            new = head + tail
        out.append(_open_preserving(n.group(1)) + new + n.group(3))

    out.append(para[cursor:])
    return "".join(out), True

def replace_everywhere(xml: str, target: str, replacement: str) -> tuple[str, int]:
    """Заменяет во всех абзацах документа. Возвращает новый XML и число замен."""
    count = 0
    def per_para(m):
        nonlocal count
        para = m.group(0)
        while True:
            new, done = replace_in_paragraph(para, target, replacement)
            if not done:
                return para
            count += 1
            para = new
            if count > 200:
                return para
    return re.sub(r'<w:p\b.*?</w:p>', per_para, xml, flags=re.S), count
