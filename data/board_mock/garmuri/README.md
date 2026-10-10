# 갈무리 방법 비교 (2026-10-10)

모의 답 464건(`../answers.json`)으로 워드클라우드(A)·자동 그룹핑(B)·AI 요약(C)을 비교했다.

- `blind_input.json` / `blind_key.json` — 라벨을 숨기고 항목별로 섞은 입력과 정답 대응표
- `llm_output.json` — C. Claude(Sonnet)가 blind_input만 보고 만든 주제·배정·헤드라인
- `analyze.py` — A·B 실행 + A·B·C 채점(ARI/NMI, 라벨별 F1, 주제 밖 탐지). `pip install kiwipiepy wordcloud scikit-learn`
- `results.json` — 채점 결과, `wc/` — 항목별 워드클라우드(`*_tuned.png`는 공통어 제거판)

결과(평균): B ARI 0.16 · NMI 0.40 / C ARI 0.78 · NMI 0.85. 소수 주제 F1 B 0.40 / C 0.86.
