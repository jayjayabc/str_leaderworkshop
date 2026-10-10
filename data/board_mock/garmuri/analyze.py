import json, collections, random, time, sys
import numpy as np
from kiwipiepy import Kiwi
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.cluster import KMeans, AgglomerativeClustering
from sklearn.metrics import adjusted_rand_score as ARI, normalized_mutual_info_score as NMI
import os; S=os.path.dirname(os.path.abspath(__file__))
D=os.path.join(S,'..')
A=json.load(open(D+'/answers.json')); L=json.load(open(D+'/labels.json'))
blind=json.load(open(S+'/blind_input.json')); key=json.load(open(S+'/blind_key.json'))
llm=json.load(open(S+'/llm_output.json'))
kiwi=Kiwi()
STOP=set("것 수 등 때 거 좀 더 안 쪽 듯 게 건 데 뭐 중 정도 우리 저희 부분 경우 이것 그것 해 하 되 있 없 같 않 보 주 받 쓰 나 내 제 지금 앞 이번 올해".split())
def nouns(t):
    return [x.form for x in kiwi.tokenize(t) if x.tag in('NNG','NNP','SL') and len(x.form)>1 and x.form not in STOP]
off_true={(o['item_id'],o['team_id']) for o in L['offtopic']}
res={}
def bestF1(true,pred):
    out={}
    for lab in set(true):
        T={i for i,t in enumerate(true) if t==lab}; best=0
        for c in set(pred):
            P={i for i,p in enumerate(pred) if p==c}; tp=len(T&P)
            if tp: best=max(best,2*tp/(len(T)+len(P)))
        out[lab]=(len(T),best)
    return out
for it in blind:
    rows=blind[it]; texts=[r['body'] for r in rows]; true=[key[it][str(r['n'])] for r in rows]
    k=len(set(true)); r={'k_true':k}
    # A: keyword freq
    toks=[nouns(t) for t in texts]
    cnt=collections.Counter(w for ts in toks for w in set(ts))
    top=cnt.most_common(20); r['A_top']=top
    # label signature: words most over-represented per label
    lab_words=collections.defaultdict(collections.Counter)
    for ts,t in zip(toks,true): lab_words[t].update(set(ts))
    cover={}; topset={w for w,_ in top}
    for lab,c in lab_words.items():
        n=true.count(lab)
        sig=sorted(c, key=lambda w:-(c[w]/n - (cnt[w]-c[w])/max(1,58-n)))[:3]
        cover[lab]=(n,sig,bool(set(sig)&topset))
    r['A_cover']=cover
    # generic share: top words whose occurrences spread over >=3 labels with no label > 50%
    gen=[]
    for w,f in top:
        dist=collections.Counter(t for ts,t in zip(toks,true) if w in ts)
        if dist.most_common(1)[0][1]/f<0.5: gen.append(w)
    r['A_generic']=gen
    # word cloud image
    from wordcloud import WordCloud
    wc=WordCloud(font_path='/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',width=900,height=500,background_color='white',colormap='viridis',max_words=40,prefer_horizontal=1.0,random_state=3).generate_from_frequencies(dict(cnt.most_common(40)))
    wc.to_file(f"{S}/wc/{it}.png")
    # B: clustering
    t0=time.time()
    for name,vec in [('char',TfidfVectorizer(analyzer='char_wb',ngram_range=(2,3),min_df=2,sublinear_tf=True)),
                     ('noun',TfidfVectorizer(analyzer=lambda s:nouns(s),min_df=1,sublinear_tf=True))]:
        X=vec.fit_transform(texts)
        ari=[];nmi=[];f1s=[]
        for seed in range(5):
            p=KMeans(n_clusters=k,n_init=10,random_state=seed).fit_predict(X)
            ari.append(ARI(true,p)); nmi.append(NMI(true,p))
        r[f'B_{name}_km']=(np.mean(ari),np.mean(nmi))
        p=AgglomerativeClustering(n_clusters=k,metric='cosine',linkage='average').fit_predict(X.toarray()+1e-6)
        r[f'B_{name}_agg']=(ARI(true,p),NMI(true,p))
        if name=='noun':
            p=KMeans(n_clusters=k,n_init=10,random_state=0).fit_predict(X)
            r['B_f1']=bestF1(true,list(p))
            sizes=collections.Counter(p); r['B_sizes']=sorted(sizes.values(),reverse=True)
            terms=np.array(vec.get_feature_names_out()); Xa=X.toarray()
            r['B_names']=[(int(sizes[c]),list(terms[Xa[p==c].mean(0).argsort()[::-1][:3]])) for c in sorted(sizes,key=lambda c:-sizes[c])]
    r['B_sec']=time.time()-t0
    # C: LLM
    o=llm[it]; pred=[o['assign'][str(r_['n'])] for r_ in rows]
    r['C']=(ARI(true,pred),NMI(true,pred)); r['C_k']=len(set(pred)); r['C_f1']=bestF1(true,pred)
    r['C_headline']=o['headline']; r['C_themes']=[(t['title'],t['count']) for t in o['themes']]
    # offtopic detection vs truth
    team_by_n={}
    rws=[x for x in A if x['item_id']==it]
    body2team={x['body']:x['team_id'] for x in rws}
    trueoff={r_['n'] for r_ in rows if (it,body2team[r_['body']]) in off_true}
    predoff=set(o.get('offtopic',[]))
    r['C_off']=(len(trueoff),len(predoff),len(trueoff&predoff))
    r['C_offbodies']=[(n,rows[n-1]['body'],key[it][str(n)]) for n in sorted(predoff|trueoff)]
    res[it]=r
json.dump(res,open(S+'/results.json','w'),ensure_ascii=False,indent=1,default=lambda x: float(x) if isinstance(x,np.floating) else int(x) if isinstance(x,np.integer) else bool(x) if isinstance(x,np.bool_) else str(x))
# print summary
print("item k | B char km ARI | B noun km ARI | B noun agg | C ARI NMI k | off true/pred/hit")
for it,r in res.items():
    print(it,r['k_true'],'| %.2f'%r['B_char_km'][0],'| %.2f/%.2f'%r['B_noun_km'],'| %.2f'%r['B_noun_agg'][0],'| %.2f %.2f %d'%(r['C'][0],r['C'][1],r['C_k']),'|',r['C_off'])
m=lambda f: np.mean([f(r) for r in res.values()])
print('MEAN B_char_km ARI %.2f NMI %.2f | B_noun_km ARI %.2f NMI %.2f | C ARI %.2f NMI %.2f'%(m(lambda r:r['B_char_km'][0]),m(lambda r:r['B_char_km'][1]),m(lambda r:r['B_noun_km'][0]),m(lambda r:r['B_noun_km'][1]),m(lambda r:r['C'][0]),m(lambda r:r['C'][1])))
# minority (label n<=6) best F1
small=[(it,l,v) for it,r in res.items() for l,v in r['C_f1'].items() if v[0]<=6]
print('small labels',len(small),'C meanF1 %.2f'%np.mean([v[1] for _,_,v in small]),'B meanF1 %.2f'%np.mean([res[it]['B_f1'][l][1] for it,l,_ in small]))
big=[(it,l,v) for it,r in res.items() for l,v in r['C_f1'].items() if v[0]>6]
print('big labels',len(big),'C meanF1 %.2f'%np.mean([v[1] for _,_,v in big]),'B meanF1 %.2f'%np.mean([res[it]['B_f1'][l][1] for it,l,_ in big]))
print('A coverage: labels whose signature words appear in top20: %d/%d'%(sum(v[2] for r in res.values() for v in r['A_cover'].values()),sum(len(r['A_cover']) for r in res.values())))
print('A small-label coverage %d/%d'%(sum(v[2] for r in res.values() for v in r['A_cover'].values() if v[0]<=6),sum(1 for r in res.values() for v in r['A_cover'].values() if v[0]<=6)))
for it,r in res.items(): print(it,'TOP',[w for w,_ in r['A_top'][:10]],'GENERIC',r['A_generic'][:8])
for it,r in res.items(): print(it,'B clusters',r['B_names']); print('   C',r['C_themes'],r['C_headline'])
