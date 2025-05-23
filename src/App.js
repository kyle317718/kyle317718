import React, { useState, useEffect } from 'react';
import './App.css';
import Papa from 'papaparse';

const DEEPSEEK_API_KEY = "sk-b59e1e44161c4021a1bb91c149294fbb";
const DS_API_URL = "https://api.deepseek.com/v1/chat/completions";

// Google Sheets API 설정
const SHEET_ID = '1US8AATADOtfyaLfDJtYpgvHtRvorcKUxHOZnvyjBxts';
const WORDS_SHEET = 'Words'; // 단어 시트 이름
const SENTENCES_SHEET = 'Sentences'; // 문장 시트 이름

async function fetchDeepSeekData(prompt) {
  const res = await fetch(DS_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await res.json();
  try {
    const content = data.choices[0].message.content;
    console.log('DeepSeek 응답:', content);
    // 가장 먼저 나오는 배열만 추출
    const match = content.match(/\[[\s\S]*?\]/);
    if (!match) return [];
    let arr = [];
    try {
      arr = JSON.parse(match[0]);
      if (!Array.isArray(arr)) return [];
    } catch {
      return [];
    }
    const mappedArr = arr
      .filter(
        w =>
          w &&
          typeof w === 'object' &&
          (w['중국어'] || w.chinese) &&
          (w['병음'] || w.pinyin) &&
          (w['뜻'] || w['한글'] || w.korean) &&
          typeof (w['중국어'] || w.chinese) === 'string' &&
          typeof (w['병음'] || w.pinyin) === 'string' &&
          typeof (w['뜻'] || w['한글'] || w.korean) === 'string' &&
          !/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(w['병음'] || w.pinyin)
      )
      .map(w => ({
        chinese: w['중국어'] || w.chinese,
        pinyin: w['병음'] || w.pinyin,
        korean: w['뜻'] || w['한글'] || w.korean,
      }));
    return mappedArr;
  } catch (e) {
    console.error('파싱 오류:', e);
    return [];
  }
}

async function fetchGoogleSheetData(sheetName) {
  try {
    const response = await fetch(
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${sheetName}`
    );
    const text = await response.text();
    return new Promise((resolve) => {
      Papa.parse(text, {
        header: true,
        complete: (results) => {
          const data = results.data
            .filter(row => row['중국어'] && row['뜻'] && row['병음']) // 빈 행 제거
            .map(row => ({
              chinese: row['중국어'],
              korean: row['뜻'],
              pinyin: row['병음'],
              level: row['분류'] || '1'
            }));
          resolve(data);
        }
      });
    });
  } catch (error) {
    console.error('Google Sheets 데이터 로딩 실패:', error);
    return [];
  }
}

function playTTS(text) {
  const utter = new window.SpeechSynthesisUtterance(text);
  utter.lang = 'zh-CN';
  window.speechSynthesis.speak(utter);
}

function WordCard({ word }) {
  return (
    <div className="wordcard" style={{
      width: 220, height: 120, margin: 16, border: '2px solid #61dafb', borderRadius: 12,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      fontSize: 24, background: '#282c34', color: '#fff'
    }}>
      <div style={{fontSize: 32, marginBottom: 8}}>{word.chinese}</div>
      <div style={{fontSize: 18, color: '#61dafb'}}>{word.korean}</div>
      <button style={{marginTop: 8, fontSize: 16, padding: '2px 12px', borderRadius: 6, border: '1px solid #61dafb', background: '#333', color: '#fff', cursor: 'pointer'}} onClick={() => playTTS(word.chinese)}>발음 듣기</button>
    </div>
  );
}

function Quiz({ words, onResult }) {
  const [current, setCurrent] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState(null);
  // 병음이 알파벳+성조만 있는 단어만 문제로 출제
  const validWords = words.filter(w => w.pinyin && !/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(w.pinyin));
  const quizWord = validWords[current];
  // 보기 랜덤 섞기
  const options = [...validWords].sort(() => Math.random() - 0.5).slice(0, 2);
  if (!options.find(w => w.chinese === quizWord?.chinese)) options[0] = quizWord;
  options.sort(() => Math.random() - 0.5);

  // 키보드 단축키 지원
  useEffect(() => {
    if (!quizWord || !validWords.length) return;
    const handleKey = (e) => {
      if (e.key === 'Enter') {
        playTTS(quizWord.chinese);
      } else if (e.key === 'ArrowLeft') {
        setCurrent(i => i > 0 ? i - 1 : validWords.length - 1);
        setShowResult(false); setResult(null); setSelected(null);
      } else if (e.key === 'ArrowRight') {
        setCurrent(i => (i + 1) % validWords.length);
        setShowResult(false); setResult(null); setSelected(null);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [quizWord, validWords.length]);

  if (!validWords.length) return <div>퀴즈 데이터를 불러올 수 없습니다.</div>;

  const handleAnswer = (chinese) => {
    if (showResult) return;
    setSelected(chinese);
    const isCorrect = chinese === quizWord.chinese;
    setResult(isCorrect ? '정답!' : '오답!');
    setShowResult(true);
    onResult(isCorrect);
    setTimeout(() => {
      setShowResult(false);
      setResult(null);
      setSelected(null);
      setCurrent((prev) => (prev + 1) % validWords.length);
    }, 1200);
  };
  return (
    <div style={{marginTop: 40}}>
      <div style={{
        fontSize: '2.3rem',
        fontWeight: 900,
        fontFamily: `'Jua', 'GmarketSans', 'Comic Sans MS', 'Comic Sans', 'NanumSquareRound', 'cursive'`,
        color: '#ff7eb9', // 연핑크
        textShadow: '0 2px 12px #ffd6fa, 0 1px 0 #fff, 0 0 2px #bdb2ff',
        padding: '14px 0',
        marginBottom: 16,
        letterSpacing: '0.04em',
        borderRadius: 12,
        display: 'inline-block',
        background: 'none',
        transition: 'all 0.2s',
      }}>
        퀴즈: 발음을 듣고 중국어(한자)를 고르세요
      </div>
      <div style={{display: 'flex', gap: 16, justifyContent: 'center', marginTop: 8}}>
        {options.map((w, idx) => {
          // 파스텔톤 배경 3가지 중 랜덤 선택(인덱스별)
          const pastelColors = ['#fff6a9', '#ffd6fa', '#b5ead7'];
          let baseBg = pastelColors[idx % pastelColors.length];
          let style = {
            fontSize: 28,
            padding: '16px 38px',
            borderRadius: 16,
            border: '2.5px solid #61dafb',
            background: baseBg,
            color: '#333',
            fontWeight: 700,
            boxShadow: '0 2px 12px #61dafb22',
            cursor: 'pointer',
            transition: 'all 0.18s',
            marginBottom: 4,
            outline: 'none',
          };
          if (selected) {
            if (w.chinese === quizWord.chinese) style.background = '#b5ead7'; // 정답: 연초록
            else if (w.chinese === selected) style.background = '#ffd6fa'; // 오답: 연핑크
            else style.opacity = 0.5;
          }
          return (
            <button
              key={idx}
              style={style}
              onClick={() => handleAnswer(w.chinese)}
              onMouseOver={e => e.currentTarget.style.background = '#ffe066'}
              onMouseOut={e => e.currentTarget.style.background = baseBg}
            >
              {w.chinese}
            </button>
          );
        })}
      </div>
      <div style={{display:'flex', justifyContent:'center', marginTop: 18, marginBottom: 8}}>
        <button style={{fontSize: 22, padding: '6px 24px', borderRadius: 8, border: '2px solid #61dafb', background: '#333', color: '#fff', cursor: 'pointer'}} onClick={() => playTTS(quizWord?.chinese)}>발음 듣기</button>
      </div>
      {showResult && <div style={{marginTop: 16, fontSize: 22}}>{result}</div>}
      <div style={{display:'flex', justifyContent:'center', alignItems:'center', gap:32, marginTop:24}}>
        <button onClick={()=>{setCurrent(i=>i>0?i-1:validWords.length-1); setShowResult(false); setResult(null); setSelected(null);}} style={{fontSize:22, padding:'4px 18px', borderRadius:8, border:'2px solid #0077b6', background:'#fff', color:'#0077b6', cursor:'pointer'}}>←</button>
        <span style={{fontSize:18, color:'#222'}}>{current+1} / {validWords.length}</span>
        <button onClick={()=>{setCurrent(i=>(i+1)%validWords.length); setShowResult(false); setResult(null); setSelected(null);}} style={{fontSize:22, padding:'4px 18px', borderRadius:8, border:'2px solid #0077b6', background:'#fff', color:'#0077b6', cursor:'pointer'}}>→</button>
      </div>
      <div style={{marginTop:12, fontSize:14, color:'#888'}}>(Enter: 발음 듣기, ←/→: 이전/다음)</div>
    </div>
  );
}

function Section({ title, bg, children }) {
  return (
    <section style={{background: bg, width: '100vw', minHeight: '45vh', padding: 0, margin: 0}}>
      <div style={{maxWidth: 900, margin: '0 auto', padding: 24}}>
        <h1 style={{marginBottom: 16}}>{title}</h1>
        {children}
      </div>
    </section>
  );
}

function ImageMatchGame({ words }) {
  const [current, setCurrent] = useState(0);
  const [uploadedImg, setUploadedImg] = useState(null);
  const [result, setResult] = useState(null);
  const [score, setScore] = useState(0);
  if (!words || words.length === 0) return <div>게임 데이터를 불러올 수 없습니다.</div>;
  const word = words[current];
  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) setUploadedImg(URL.createObjectURL(file));
  };
  const handleResult = (isCorrect) => {
    setResult(isCorrect ? '정답!' : '오답!');
    if (isCorrect) setScore(s => s + 1);
    setTimeout(() => {
      setResult(null);
      setUploadedImg(null);
      setCurrent((c) => (c + 1) % words.length);
    }, 1200);
  };
  return (
    <div style={{textAlign: 'center', marginTop: 40}}>
      <div style={{fontSize: 32, marginBottom: 16, color: '#222'}}>{word.chinese}</div>
      <div style={{fontSize: 20, color: '#0077b6', marginBottom: 16}}>{word.korean}</div>
      <input type="file" accept="image/*" onChange={handleImageUpload} style={{marginBottom: 12}} />
      {uploadedImg && (
        <div style={{margin: '16px 0'}}>
          <img src={uploadedImg} alt="업로드 미리보기" style={{maxWidth: 200, maxHeight: 200, borderRadius: 8, border: '2px solid #0077b6'}} />
        </div>
      )}
      {uploadedImg && (
        <div>
          <button onClick={() => handleResult(true)} style={{marginRight: 12, background:'#38b000', color:'#fff', border:'none', borderRadius:6, padding:'8px 20px', fontSize:18, cursor:'pointer'}}>정답</button>
          <button onClick={() => handleResult(false)} style={{background:'#e63946', color:'#fff', border:'none', borderRadius:6, padding:'8px 20px', fontSize:18, cursor:'pointer'}}>오답</button>
        </div>
      )}
      <div style={{marginTop: 24, fontSize: 18, color:'#222'}}>점수: {score} / {words.length}</div>
      {result && <div style={{fontSize: 24, marginTop: 16, color: result==='정답!'?'#38b000':'#e63946'}}>{result}</div>}
    </div>
  );
}

function uniqueByChinese(arr) {
  // 한자(중국어) 기준으로 중복 제거
  const map = new Map();
  arr.forEach(w => {
    if (w && w.chinese) map.set(w.chinese, w);
  });
  return Array.from(map.values());
}

function UploadCSV({ type, onUpload }) {
  // type: 'word' | 'sentence'
  const sample = type === 'word'
    ? '중국어,뜻,병음,분류(1~10단계 숫자)\n谢谢,고마워,xièxie,1\n你好,안녕하세요,nǐ hǎo,1\n妈妈,엄마,māma,2'
    : '중국어,뜻,병음,분류(1~10단계 숫자)\n我饿了,배고파요,wǒ è le,1\n我去学校,저는 학교에 갑니다,wǒ qù xuéxiào,2';
  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      complete: (results) => {
        // 필수 필드만 추출
        const arr = results.data
          .map(row => ({
            chinese: row['중국어'],
            korean: row['뜻'],
            pinyin: row['병음']
          }))
          .filter(w => w.chinese && w.korean);
        onUpload(arr);
      }
    });
  };
  return (
    <div style={{margin: '24px 0', textAlign: 'center'}}>
      <div style={{marginBottom: 8, fontWeight: 500}}>
        {type === 'word' ? '단어' : '문장'} CSV 업로드<br/>
        <span style={{fontSize: 13, color: '#555'}}>샘플: <code>{sample}</code></span>
      </div>
      <input type="file" accept=".csv" onChange={handleFile} />
    </div>
  );
}

function SingleWordViewer({ words }) {
  const [idx, setIdx] = useState(0);
  const total = words?.length || 0;
  const word = words && words.length > 0 ? words[idx] : null;

  // 키보드 단축키 지원
  useEffect(() => {
    const handleKey = (e) => {
      if (!word) return;
      if (e.key === 'Enter') {
        playTTS(word.chinese);
      } else if (e.key === 'ArrowLeft') {
        setIdx(i => i > 0 ? i - 1 : total - 1);
      } else if (e.key === 'ArrowRight') {
        setIdx(i => (i + 1) % total);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [word, total]);

  if (!words || words.length === 0) return <div>데이터가 없습니다.</div>;
  if (!word) return null;
  return (
    <div style={{textAlign: 'center', marginTop: 40}}>
      <div
        className="cute-card"
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          background: '#fff', border: '5px solid #61dafb', borderRadius: 18,
          boxShadow: '0 4px 16px #61dafb22',
          padding: '32px 36px 24px 36px', margin: '0 auto 24px auto',
          minWidth: 420, maxWidth: 700, transition: 'box-shadow 0.2s',
        }}
      >
        {word.pinyin && <span style={{color:'#e67e22', fontSize:32, fontWeight:400, marginBottom:2, lineHeight:1, whiteSpace:'nowrap', overflow:'auto', width:'100%', textAlign:'center'}}>{word.pinyin}</span>}
        <span style={{color:'#222', fontSize: 44, fontWeight:600, lineHeight:1, whiteSpace:'nowrap', overflow:'auto', width:'100%', textAlign:'center'}}>{word.chinese}</span>
        <div style={{color:'#0077b6', fontSize:32, marginTop: 10, whiteSpace:'nowrap', overflow:'auto', width:'100%', textAlign:'center'}}>{word.korean}</div>
      </div>
      <style>{`
        .cute-card:hover {
          box-shadow: 0 8px 32px #61dafb55;
          border-color: #38b6ff;
        }
      `}</style>
      <button style={{margin:'16px 0 32px 0', fontSize: 22, padding: '6px 24px', borderRadius: 8, border: '2px solid #61dafb', background: '#333', color: '#fff', cursor: 'pointer'}} onClick={() => playTTS(word.chinese)}>발음 듣기</button>
      <div style={{display:'flex', justifyContent:'center', alignItems:'center', gap:32, marginTop:16}}>
        <button onClick={()=>setIdx(i=>i>0?i-1:total-1)} style={{fontSize:28, padding:'6px 24px', borderRadius:10, border:'2px solid #0077b6', background:'#fff', color:'#0077b6', cursor:'pointer'}}>←</button>
        <span style={{fontSize:22, color:'#222', fontWeight:500}}>{idx+1} / {total}</span>
        <button onClick={()=>setIdx(i=>(i+1)%total)} style={{fontSize:28, padding:'6px 24px', borderRadius:10, border:'2px solid #0077b6', background:'#fff', color:'#0077b6', cursor:'pointer'}}>→</button>
      </div>
      <div style={{marginTop:12, fontSize:14, color:'#888'}}>(Enter: 발음 듣기, ←/→: 이전/다음)</div>
    </div>
  );
}

const LEVELS = [
  { num: 1, emoji: '⭐️', color: '#ffe066' },
  { num: 2, emoji: '💖', color: '#ffd6fa' },
  { num: 3, emoji: '🍭', color: '#b5ead7' },
  { num: 4, emoji: '🎈', color: '#caffbf' },
  { num: 5, emoji: '🌈', color: '#9bf6ff' },
  { num: 6, emoji: '🧸', color: '#a0c4ff' },
  { num: 7, emoji: '🎀', color: '#bdb2ff' },
  { num: 8, emoji: '🍩', color: '#ffc6ff' },
  { num: 9, emoji: '🦄', color: '#fdffb6' },
  { num: 10, emoji: '🥳', color: '#fffffc' },
];

function LevelSelect({ onSelect }) {
  return (
    <div style={{display:'flex', flexWrap:'wrap', justifyContent:'center', gap:24, marginTop:40, marginBottom:40}}>
      {LEVELS.map(lvl => (
        <button
          key={lvl.num}
          onClick={() => onSelect(lvl.num)}
          className='level-btn'
          style={{
            width: 110, height: 110, borderRadius: 20, border: '3px solid #61dafb',
            background: lvl.color, fontSize: 32, fontWeight: 700, color: '#333',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            boxShadow: '2px 4px 12px #0001', cursor: 'pointer', transition: 'transform 0.15s, box-shadow 0.15s',
            marginBottom: 8
          }}
        >
          <span style={{fontSize: 40}}>{lvl.emoji}</span>
          <span style={{fontSize: 20, marginTop: 4}}>단계 {lvl.num}</span>
        </button>
      ))}
      <style>{`
        .level-btn:hover {
          transform: scale(1.08);
          box-shadow: 0 0 16px #61dafb88;
        }
        .level-btn:active {
          animation: jelly-pop 0.4s;
        }
        @keyframes jelly-pop {
          0% { transform: scale(1);}
          30% { transform: scale(1.15, 0.85);}
          50% { transform: scale(0.95, 1.05);}
          70% { transform: scale(1.05, 0.95);}
          100% { transform: scale(1);}
        }
      `}</style>
    </div>
  );
}

function SentenceLevelPage({ sentences }) {
  const [selectedLevel, setSelectedLevel] = useState(null);
  // 단계별 문장 필터링 (단계 컬럼이 없으면 1단계로 간주)
  const filtered = selectedLevel
    ? sentences.filter(w => (Number(w.level) || Number(w['분류']) || 1) === selectedLevel)
    : [];
  if (selectedLevel === null) {
    return <LevelSelect onSelect={setSelectedLevel} />;
  }
  return (
    <div>
      <button onClick={() => setSelectedLevel(null)} style={{margin: 24, fontSize: 18, borderRadius: 8, border: '2px solid #61dafb', background: '#fff', color: '#0077b6', padding: '6px 18px', cursor: 'pointer'}}>← 단계 선택으로</button>
      <SingleWordViewer words={filtered} />
    </div>
  );
}

function WordLevelPage({ words }) {
  const [selectedLevel, setSelectedLevel] = useState(null);
  const filtered = selectedLevel
    ? words.filter(w => (Number(w.level) || Number(w['분류']) || 1) === selectedLevel)
    : [];
  if (selectedLevel === null) {
    return <LevelSelect onSelect={setSelectedLevel} />;
  }
  return (
    <div>
      <button onClick={() => setSelectedLevel(null)} style={{margin: 24, fontSize: 18, borderRadius: 8, border: '2px solid #61dafb', background: '#fff', color: '#0077b6', padding: '6px 18px', cursor: 'pointer'}}>← 단계 선택으로</button>
      <SingleWordViewer words={filtered} />
    </div>
  );
}

function App() {
  const [wordCards, setWordCards] = useState([]);
  const [sentenceCards, setSentenceCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [correct, setCorrect] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [total, setTotal] = useState(0);
  const [correctS, setCorrectS] = useState(0);
  const [wrongS, setWrongS] = useState(0);
  const [totalS, setTotalS] = useState(0);
  const [view, setView] = useState('wordCard');
  const [showUpload, setShowUpload] = useState(null); // 'word' | 'sentence' | null
  const [quizKey, setQuizKey] = useState(Date.now());

  useEffect(() => {
    // Google Sheets에서 데이터 로딩
    Promise.all([
      fetchGoogleSheetData(WORDS_SHEET),
      fetchGoogleSheetData(SENTENCES_SHEET)
    ])
      .then(([words, sentences]) => {
        setWordCards(words);
        setSentenceCards(sentences);
        // 로컬에도 캐시
        localStorage.setItem('wordCards', JSON.stringify(words));
        localStorage.setItem('sentenceCards', JSON.stringify(sentences));
        setLoading(false);
      })
      .catch(err => {
        console.error('데이터 로딩 실패:', err);
        // 로컬 캐시 데이터 시도
        try {
          const savedWords = JSON.parse(localStorage.getItem('wordCards') || '[]');
          const savedSentences = JSON.parse(localStorage.getItem('sentenceCards') || '[]');
          setWordCards(savedWords);
          setSentenceCards(savedSentences);
        } catch (e) {
          setError('데이터를 불러오지 못했습니다.');
        }
        setLoading(false);
      });
  }, []);

  // view가 wordQuiz로 바뀔 때마다 quizKey 갱신
  useEffect(() => {
    if (view === 'wordQuiz') setQuizKey(Date.now());
  }, [view]);

  const handleQuizResult = (isCorrect) => {
    setTotal((t) => t + 1);
    if (isCorrect) setCorrect((c) => c + 1);
    else setWrong((w) => w + 1);
  };
  const handleQuizResultS = (isCorrect) => {
    setTotalS((t) => t + 1);
    if (isCorrect) setCorrectS((c) => c + 1);
    else setWrongS((w) => w + 1);
  };

  const handleUpload = (type, arr) => {
    // 업로드 기능은 관리자만 사용하도록 변경 예정
    alert('데이터는 구글 스프레드시트에서 관리됩니다.');
    setShowUpload(null);
  };

  if (loading) return <div style={{color:'#222', fontSize:24, textAlign:'center', marginTop:80}}>데이터 불러오는 중...</div>;
  if (error) return <div style={{color:'#e63946', fontSize:24, textAlign:'center', marginTop:80}}>{error}</div>;

  return (
    <div className="App" style={{background: '#f6f9fa', minHeight: '100vh', margin: 0, padding: 0}}>
      <div style={{display: 'flex', justifyContent: 'center', gap: 16, margin: 24}}>
        <button onClick={() => setView('wordCard')} style={{background:view==='wordCard'?'#0077b6':'#fff', color:view==='wordCard'?'#fff':'#0077b6', border:'2px solid #0077b6', borderRadius:8, padding:'8px 20px', fontSize:18, cursor:'pointer'}}>단어 카드</button>
        <button onClick={() => setView('wordQuiz')} style={{background:view==='wordQuiz'?'#0077b6':'#fff', color:view==='wordQuiz'?'#fff':'#0077b6', border:'2px solid #0077b6', borderRadius:8, padding:'8px 20px', fontSize:18, cursor:'pointer'}}>단어 퀴즈</button>
        <button onClick={() => setView('sentenceCard')} style={{background:view==='sentenceCard'?'#0077b6':'#fff', color:view==='sentenceCard'?'#fff':'#0077b6', border:'2px solid #0077b6', borderRadius:8, padding:'8px 20px', fontSize:18, cursor:'pointer'}}>문장 카드</button>
        <button onClick={() => setView('sentenceQuiz')} style={{background:view==='sentenceQuiz'?'#0077b6':'#fff', color:view==='sentenceQuiz'?'#fff':'#0077b6', border:'2px solid #0077b6', borderRadius:8, padding:'8px 20px', fontSize:18, cursor:'pointer'}}>문장 퀴즈</button>
        <button onClick={() => setView('imageMatch')} style={{background:view==='imageMatch'?'#38b000':'#fff', color:view==='imageMatch'?'#fff':'#38b000', border:'2px solid #38b000', borderRadius:8, padding:'8px 20px', fontSize:18, cursor:'pointer'}}>이미지 매칭 게임</button>
        <button onClick={() => setShowUpload('word')} style={{background:'#fff', color:'#0077b6', border:'2px solid #0077b6', borderRadius:8, padding:'8px 20px', fontSize:18, cursor:'pointer'}}>단어 업로드</button>
        <button onClick={() => setShowUpload('sentence')} style={{background:'#fff', color:'#0077b6', border:'2px solid #0077b6', borderRadius:8, padding:'8px 20px', fontSize:18, cursor:'pointer'}}>문장 업로드</button>
      </div>
      {showUpload === 'word' && <UploadCSV type="word" onUpload={arr => handleUpload('word', arr)} />}
      {showUpload === 'sentence' && <UploadCSV type="sentence" onUpload={arr => handleUpload('sentence', arr)} />}
      {view === 'wordCard' && (
        <Section title="중국어 단어 카드" bg="#f6f9fa">
          <WordLevelPage words={wordCards} />
        </Section>
      )}
      {view === 'wordQuiz' && (
        <Section title="단어 퀴즈" bg="#e3f2fd">
          <Quiz key={quizKey} words={wordCards} onResult={handleQuizResult} />
          <div style={{marginTop: 32, fontSize: 18, color: '#0077b6'}}>
            <b>학습 기록</b><br />
            전체 문제: {total} &nbsp;|&nbsp; 정답: {correct} &nbsp;|&nbsp; 오답: {wrong}
          </div>
        </Section>
      )}
      {view === 'sentenceCard' && (
        <Section title="중국어 문장 카드" bg="#f6f9fa">
          <SentenceLevelPage sentences={sentenceCards} />
        </Section>
      )}
      {view === 'sentenceQuiz' && (
        <Section title="문장 퀴즈" bg="#e3f2fd">
          <Quiz words={sentenceCards} onResult={handleQuizResultS} />
          <div style={{marginTop: 32, fontSize: 18, color: '#0077b6'}}>
            <b>학습 기록</b><br />
            전체 문제: {totalS} &nbsp;|&nbsp; 정답: {correctS} &nbsp;|&nbsp; 오답: {wrongS}
          </div>
        </Section>
      )}
      {view === 'imageMatch' && (
        <Section title="이미지 매칭 게임" bg="#f6f9fa">
          <ImageMatchGame words={wordCards} />
        </Section>
      )}
    </div>
  );
}

export default App;
