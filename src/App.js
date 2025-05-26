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
          console.log('구글시트 원본 데이터:', results.data);
          const data = results.data
            .filter(row => row['중국어'] && (row['뜻'] || row['뜻(한글)']) && row['병음'])
            .map(row => ({
              chinese: row['중국어'],
              korean: row['뜻'] || row['뜻(한글)'] || '',
              english: row['영어'] || row['english'] || '',
              pinyin: row['병음'],
              level: row['분류'] || '1'
            }));
          console.log('파싱된 데이터:', data);
          resolve(data);
        }
      });
    });
  } catch (error) {
    console.error('Google Sheets 데이터 로딩 실패:', error);
    return [];
  }
}

function playTTS(text, langOverride) {
  let lang = langOverride || 'zh-CN';
  if (!langOverride && /[가-힣]/.test(text)) lang = 'ko-KR';
  const synth = window.speechSynthesis;
  let voices = synth.getVoices();
  let voice = null;
  if (lang === 'zh-CN') {
    voice = voices.find(v => v.lang && v.lang.startsWith('zh'));
  } else if (lang === 'ko-KR') {
    voice = voices.find(v => v.lang && v.lang.startsWith('ko'));
  } else if (lang === 'en-US') {
    voice = voices.find(v => v.lang && v.lang.startsWith('en'));
  }
  const utter = new window.SpeechSynthesisUtterance(text);
  utter.lang = lang;
  if (voice) utter.voice = voice;
  synth.speak(utter);
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

  // --- 보기 4개, 오답 강화 ---
  function getOptions(word, allWords, count = 4) {
    // 정답 제외, 병음 첫글자/한글 뜻이 비슷한 것 우선, 부족하면 랜덤
    let candidates = allWords.filter(w => w.chinese !== word.chinese);
    // 병음 첫글자, 한글 첫글자 기준 비슷한 것 우선
    const pinyinFirst = word.pinyin?.[0] || '';
    const koreanFirst = word.korean?.[0] || '';
    let similar = candidates.filter(w => w.pinyin?.[0] === pinyinFirst || w.korean?.[0] === koreanFirst);
    // 부족하면 랜덤 추가
    if (similar.length < count - 1) {
      const rest = candidates.filter(w => !similar.includes(w));
      similar = similar.concat(rest.sort(() => Math.random() - 0.5).slice(0, count - 1 - similar.length));
    } else {
      similar = similar.sort(() => Math.random() - 0.5).slice(0, count - 1);
    }
    const options = [word, ...similar].sort(() => Math.random() - 0.5);
    return options;
  }
  const options = quizWord ? getOptions(quizWord, validWords, 4) : [];
  // --- 보기 4개, 오답 강화 끝 ---

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
          background: '#fff', border: '5px solid #61dafb', borderRadius: 24,
          boxShadow: '0 4px 24px #61dafb33',
          padding: '28px 28px 20px 28px', margin: '0 auto 24px auto',
          minWidth: 340, maxWidth: 600, minHeight: 200, transition: 'box-shadow 0.2s',
        }}
      >
        {word.pinyin && <span style={{color:'#e67e22', fontSize:26, fontWeight:400, marginBottom:2, lineHeight:1, whiteSpace:'nowrap', overflow:'auto', width:'100%', textAlign:'center'}}>{word.pinyin}</span>}
        <span style={{color:'#222', fontSize: 38, fontWeight:700, lineHeight:1, whiteSpace:'nowrap', overflow:'auto', width:'100%', textAlign:'center', marginBottom: 6}}>{word.chinese}</span>
        <div style={{color:'#0077b6', fontSize:26, marginTop: 6, marginBottom: 6, width:'100%', textAlign:'center'}}>
          {word.korean}
        </div>
        {word.english && (
          <div style={{color:'#e67e22', fontSize:22, marginTop: 4, marginBottom: 4, fontWeight: 500, width:'100%', textAlign:'center'}}>
            {word.english}
          </div>
        )}
      </div>
      <style>{`
        .cute-card:hover {
          box-shadow: 0 8px 32px #61dafb55;
          border-color: #38b6ff;
        }
      `}</style>
      <button style={{margin:'16px 0 8px 0', fontSize: 22, padding: '6px 24px', borderRadius: 8, border: '2px solid #61dafb', background: '#333', color: '#fff', cursor: 'pointer'}} onClick={() => playTTS(word.chinese)}>발음 듣기</button>
      {word.english && (
        <button style={{margin:'0 0 32px 12px', fontSize: 18, padding: '6px 18px', borderRadius: 8, border: '2px solid #e67e22', background: '#fff', color: '#e67e22', cursor: 'pointer'}} onClick={() => playTTS(word.english, 'en-US')}>영어 발음 듣기</button>
      )}
      <div style={{display:'flex', justifyContent:'center', alignItems:'center', gap:32, marginTop:16}}>
        <button onClick={()=>setIdx(i=>i>0?i-1:total-1)} style={{fontSize:28, padding:'6px 24px', borderRadius:10, border:'2px solid #0077b6', background:'#fff', color:'#0077b6', cursor:'pointer'}}>←</button>
        <span style={{fontSize:22, color:'#222', fontWeight:500}}>{idx+1} / {total}</span>
        <button onClick={()=>setIdx(i=>(i+1)%total)} style={{fontSize:28, padding:'6px 24px', borderRadius:10, border:'2px solid #0077b6', background:'#fff', color:'#0077b6', cursor:'pointer'}}>→</button>
      </div>
      <div style={{marginTop:12, fontSize:14, color:'#888'}}>(Enter: 발음 듣기, ←/→: 이전/다음)</div>
    </div>
  );
}

// LEVELS 배열을 카테고리 배열로 변경
const CATEGORIES = [
  { name: '건강', emoji: '💪', color: '#ffe066' },
  { name: '경제', emoji: '💰', color: '#ffd6fa' },
  { name: '교육', emoji: '📚', color: '#b5ead7' },
  { name: '기술', emoji: '💻', color: '#caffbf' },
  { name: '비즈니스', emoji: '🏢', color: '#9bf6ff' },
  { name: '생활', emoji: '🏠', color: '#a0c4ff' },
  { name: '쇼핑', emoji: '🛒', color: '#bdb2ff' },
  { name: '여행', emoji: '✈️', color: '#ffc6ff' },
];

// CategorySelect 컴포넌트
function CategorySelect({ onSelect }) {
  return (
    <div style={{display:'flex', flexWrap:'wrap', justifyContent:'center', gap:24, marginTop:40, marginBottom:40}}>
      {CATEGORIES.map(cat => (
        <button
          key={cat.name}
          onClick={() => onSelect(cat.name)}
          className='category-btn'
          style={{
            width: 110, height: 110, borderRadius: 20, border: '3px solid #61dafb',
            background: cat.color, fontSize: 32, fontWeight: 700, color: '#333',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            boxShadow: '2px 4px 12px #0001', cursor: 'pointer', transition: 'transform 0.15s, box-shadow 0.15s',
            marginBottom: 8
          }}
        >
          <span style={{fontSize: 40}}>{cat.emoji}</span>
          <span style={{fontSize: 20, marginTop: 4}}>{cat.name}</span>
        </button>
      ))}
      <style>{`
        .category-btn:hover {
          transform: scale(1.08);
          box-shadow: 0 0 16px #61dafb88;
        }
        .category-btn:active {
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

// WordTest 컴포넌트: 단어 시험(객관식+주관식 랜덤)
function WordTest({ words, onResult }) {
  const [current, setCurrent] = React.useState(0);
  const [score, setScore] = React.useState(0);
  const [showResult, setShowResult] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const [selected, setSelected] = React.useState(null);
  const [input, setInput] = React.useState('');
  const [mode, setMode] = React.useState(Math.random() < 0.5 ? 'choice' : 'input'); // 랜덤 출제
  const [wrongList, setWrongList] = React.useState([]);
  const [reviewMode, setReviewMode] = React.useState(false); // 오답노트 복습 모드
  const [retryWrongMode, setRetryWrongMode] = React.useState(false); // 오답만 다시 풀기 모드
  const total = words.length;
  const word = words[current];

  // 객관식 보기 생성
  function getOptions(word, allWords, count = 4) {
    let candidates = allWords.filter(w => w.chinese !== word.chinese);
    let similar = candidates.sort(() => Math.random() - 0.5).slice(0, count - 1);
    const options = [word, ...similar].sort(() => Math.random() - 0.5);
    return options;
  }
  const options = word ? getOptions(word, words, 4) : [];

  // 문제 유형 랜덤 변경
  React.useEffect(() => {
    setMode(Math.random() < 0.5 ? 'choice' : 'input');
    setInput('');
    setSelected(null);
    setShowResult(false);
    setResult(null);
  }, [current]);

  if (!words || words.length === 0) return <div>시험할 단어가 없습니다.</div>;
  if (!word) return null;

  const handleChoice = (w) => {
    if (showResult) return;
    setSelected(w.chinese);
    const isCorrect = w.chinese === word.chinese;
    setResult(isCorrect ? '정답! 🎉' : '오답! 😢');
    setShowResult(true);
    if (isCorrect) setScore(s => s + 1);
    else setWrongList(list => [...list, word]);
  };

  const handleInput = () => {
    if (showResult) return;
    const isCorrect = input.trim() === word.chinese;
    setResult(isCorrect ? '정답! 🎉' : `오답! 정답: ${word.chinese}`);
    setShowResult(true);
    if (isCorrect) setScore(s => s + 1);
    else setWrongList(list => [...list, word]);
  };

  // 시험 종료
  if (reviewMode) {
    return <WordWrongNote wrongList={wrongList} onExit={()=>setReviewMode(false)} />;
  }
  if (retryWrongMode) {
    return <WordTest words={wrongList} onResult={onResult} />;
  }
  if (current === total - 1 && showResult) {
    // 기록 저장
    if (!window._wordTestSaved) {
      window._wordTestSaved = true;
      const history = JSON.parse(localStorage.getItem('testHistory')||'[]');
      history.push({
        date: new Date().toLocaleString(),
        category: word.level||word['분류']||'',
        score,
        total,
        wrongList,
        correctList: words.filter(w=>!wrongList.includes(w)),
        type: 'word'
      });
      localStorage.setItem('testHistory', JSON.stringify(history));
    }
    return (
      <div style={{textAlign:'center', marginTop:40}}>
        <div style={{fontSize:28, marginBottom:16}}>시험 종료!</div>
        <div style={{fontSize:22, marginBottom:12}}>점수: {score} / {total}</div>
        {wrongList.length > 0 && (
          <div style={{margin:'18px 0', color:'#e63946'}}>
            <b>오답노트</b><br/>
            {wrongList.map((w,i)=>(<div key={i}>{w.korean} ({w.english}) - {w.chinese}</div>))}
          </div>
        )}
        <button onClick={()=>{setCurrent(0);setScore(0);setWrongList([]);}} style={{fontSize:18, borderRadius:8, border:'2px solid #61dafb', background:'#fff', color:'#0077b6', padding:'8px 24px', cursor:'pointer', marginRight:12}}>처음부터 다시 풀기</button>
        <button onClick={()=>setRetryWrongMode(true)} style={{fontSize:18, borderRadius:8, border:'2px solid #e63946', background:'#fff', color:'#e63946', padding:'8px 24px', cursor:'pointer', marginRight:12}}>오답만 다시 풀기</button>
        <button onClick={onResult} style={{fontSize:18, borderRadius:8, border:'2px solid #e67e22', background:'#fff', color:'#e67e22', padding:'8px 24px', cursor:'pointer', marginRight:12}}>카테고리로 돌아가기</button>
        {wrongList.length > 0 && (
          <>
            <button onClick={()=>setReviewMode(true)} style={{fontSize:18, borderRadius:8, border:'2px solid #38b000', background:'#fff', color:'#38b000', padding:'8px 24px', cursor:'pointer', marginLeft:12}}>오답노트 복습</button>
          </>
        )}
      </div>
    );
  }

  return (
    <div style={{textAlign:'center', marginTop:40}}>
      <div style={{fontSize:26, marginBottom:18}}>단어 시험 ({current+1} / {total})</div>
      {mode === 'choice' ? (
        <>
          <div style={{fontSize:22, marginBottom:12}}>{word.korean} (영어: {word.english})</div>
          <div style={{display:'flex', justifyContent:'center', gap:16, marginBottom:16}}>
            {options.map((w,idx)=>(
              <button key={idx} style={{fontSize:24, padding:'12px 32px', borderRadius:12, border:'2px solid #61dafb', background:selected===w.chinese?(w.chinese===word.chinese?'#b5ead7':'#ffd6fa'):'#fff', color:'#222', fontWeight:600, cursor:'pointer', transition:'all 0.18s'}} onClick={()=>handleChoice(w)}>{w.chinese}</button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div style={{fontSize:22, marginBottom:12}}>{word.english} ({word.korean})의 중국어는?</div>
          <input type="text" value={input} onChange={e=>setInput(e.target.value)} style={{fontSize:22, padding:'8px 18px', borderRadius:8, border:'2px solid #61dafb', marginBottom:8}} placeholder="중국어 입력" autoFocus onKeyDown={e=>{if(e.key==='Enter')handleInput();}} />
          <button onClick={handleInput} style={{fontSize:18, borderRadius:8, border:'2px solid #61dafb', background:'#fff', color:'#0077b6', padding:'6px 18px', cursor:'pointer', marginLeft:8}}>제출</button>
        </>
      )}
      {showResult && <div style={{fontSize:22, marginTop:16, color:result?.includes('정답')?'#38b000':'#e63946', transition:'all 0.2s'}}>{result}</div>}
      {showResult && (
        <button onClick={() => {
          setShowResult(false);
          setResult(null);
          setSelected(null);
          setInput('');
          setCurrent((c) => (c + 1) % total);
        }}
        style={{fontSize:18, borderRadius:8, border:'2px solid #0077b6', background:'#fff', color:'#0077b6', padding:'6px 18px', cursor:'pointer', marginTop:12}}
        >다음 문제</button>
      )}
      <div style={{marginTop:24, fontSize:18, color:'#0077b6'}}>점수: {score}</div>
    </div>
  );
}

// SentenceTest 컴포넌트: 문장 시험(객관식+주관식 랜덤)
function SentenceTest({ sentences, onExit }) {
  const [current, setCurrent] = React.useState(0);
  const [score, setScore] = React.useState(0);
  const [showResult, setShowResult] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const [selected, setSelected] = React.useState(null);
  const [input, setInput] = React.useState('');
  const [mode, setMode] = React.useState(Math.random() < 0.5 ? 'choice' : 'input');
  const [wrongList, setWrongList] = React.useState([]);
  const [reviewMode, setReviewMode] = React.useState(false); // 오답노트 복습 모드
  const [retryWrongMode, setRetryWrongMode] = React.useState(false); // 오답만 다시 풀기 모드
  const total = sentences.length;
  const sentence = sentences[current];

  function getOptions(sentence, all, count=4) {
    let candidates = all.filter(w => w.chinese !== sentence.chinese);
    let similar = candidates.sort(() => Math.random() - 0.5).slice(0, count-1);
    const options = [sentence, ...similar].sort(() => Math.random() - 0.5);
    return options;
  }
  const options = sentence ? getOptions(sentence, sentences, 4) : [];

  React.useEffect(() => {
    setMode(Math.random() < 0.5 ? 'choice' : 'input');
    setInput('');
    setSelected(null);
    setShowResult(false);
    setResult(null);
  }, [current]);

  if (!sentences || sentences.length === 0) return <div>시험할 문장이 없습니다.</div>;
  if (!sentence) return null;

  const handleChoice = (w) => {
    if (showResult) return;
    setSelected(w.chinese);
    const isCorrect = w.chinese === sentence.chinese;
    setResult(isCorrect ? '정답! 🎉' : '오답! 😢');
    setShowResult(true);
    if (isCorrect) setScore(s => s + 1);
    else setWrongList(list => [...list, sentence]);
    setTimeout(() => {
      setShowResult(false);
      setResult(null);
      setSelected(null);
      setCurrent((c) => (c + 1) % total);
    }, 1200);
  };

  const handleInput = () => {
    if (showResult) return;
    const isCorrect = input.trim() === sentence.chinese;
    setResult(isCorrect ? '정답! 🎉' : `오답! 정답: ${sentence.chinese}`);
    setShowResult(true);
    if (isCorrect) setScore(s => s + 1);
    else setWrongList(list => [...list, sentence]);
    setTimeout(() => {
      setShowResult(false);
      setResult(null);
      setInput('');
      setCurrent((c) => (c + 1) % total);
    }, 1500);
  };

  // 시험 종료
  if (reviewMode) {
    return <SentenceWrongNote wrongList={wrongList} onExit={()=>setReviewMode(false)} />;
  }
  if (retryWrongMode) {
    return <SentenceTest sentences={wrongList} onExit={onExit} />;
  }
  if (current === total - 1 && showResult) {
    // 기록 저장
    if (!window._sentenceTestSaved) {
      window._sentenceTestSaved = true;
      const history = JSON.parse(localStorage.getItem('testHistory')||'[]');
      history.push({
        date: new Date().toLocaleString(),
        category: sentence.level||sentence['분류']||'',
        score,
        total,
        wrongList,
        correctList: sentences.filter(w=>!wrongList.includes(w)),
        type: 'sentence'
      });
      localStorage.setItem('testHistory', JSON.stringify(history));
    }
    return (
      <div style={{textAlign:'center', marginTop:40}}>
        <div style={{fontSize:28, marginBottom:16}}>시험 종료!</div>
        <div style={{fontSize:22, marginBottom:12}}>점수: {score} / {total}</div>
        {wrongList.length > 0 && (
          <div style={{margin:'18px 0', color:'#e63946'}}>
            <b>오답노트</b><br/>
            {wrongList.map((w,i)=>(<div key={i}>{w.korean} ({w.english}) - {w.chinese}</div>))}
          </div>
        )}
        <button onClick={()=>{setCurrent(0);setScore(0);setWrongList([]);}} style={{fontSize:18, borderRadius:8, border:'2px solid #61dafb', background:'#fff', color:'#0077b6', padding:'8px 24px', cursor:'pointer', marginRight:12}}>처음부터 다시 풀기</button>
        <button onClick={()=>setRetryWrongMode(true)} style={{fontSize:18, borderRadius:8, border:'2px solid #e63946', background:'#fff', color:'#e63946', padding:'8px 24px', cursor:'pointer', marginRight:12}}>오답만 다시 풀기</button>
        <button onClick={onExit} style={{fontSize:18, borderRadius:8, border:'2px solid #e67e22', background:'#fff', color:'#e67e22', padding:'8px 24px', cursor:'pointer', marginRight:12}}>카테고리로 돌아가기</button>
        {wrongList.length > 0 && (
          <>
            <button onClick={()=>setReviewMode(true)} style={{fontSize:18, borderRadius:8, border:'2px solid #38b000', background:'#fff', color:'#38b000', padding:'8px 24px', cursor:'pointer', marginLeft:12}}>오답노트 복습</button>
          </>
        )}
      </div>
    );
  }

  return (
    <div style={{textAlign:'center', marginTop:40}}>
      <div style={{fontSize:26, marginBottom:18}}>문장 시험 ({current+1} / {total})</div>
      {mode === 'choice' ? (
        <>
          <div style={{fontSize:22, marginBottom:12}}>{sentence.korean} (영어: {sentence.english})</div>
          <div style={{display:'flex', justifyContent:'center', gap:16, marginBottom:16}}>
            {options.map((w,idx)=>(
              <button key={idx} style={{fontSize:20, padding:'10px 24px', borderRadius:12, border:'2px solid #61dafb', background:selected===w.chinese?(w.chinese===sentence.chinese?'#b5ead7':'#ffd6fa'):'#fff', color:'#222', fontWeight:600, cursor:'pointer', transition:'all 0.18s'}} onClick={()=>handleChoice(w)}>{w.chinese}</button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div style={{fontSize:22, marginBottom:12}}>{sentence.english} ({sentence.korean})의 중국어는?</div>
          <input type="text" value={input} onChange={e=>setInput(e.target.value)} style={{fontSize:22, padding:'8px 18px', borderRadius:8, border:'2px solid #61dafb', marginBottom:8}} placeholder="중국어 입력" autoFocus onKeyDown={e=>{if(e.key==='Enter')handleInput();}} />
          <button onClick={handleInput} style={{fontSize:18, borderRadius:8, border:'2px solid #61dafb', background:'#fff', color:'#0077b6', padding:'6px 18px', cursor:'pointer', marginLeft:8}}>제출</button>
        </>
      )}
      {showResult && <div style={{fontSize:22, marginTop:16, color:result?.includes('정답')?'#38b000':'#e63946', transition:'all 0.2s'}}>{result}</div>}
      {showResult && (
        <button onClick={() => {
          setShowResult(false);
          setResult(null);
          setSelected(null);
          setInput('');
          setCurrent((c) => (c + 1) % total);
        }}
        style={{fontSize:18, borderRadius:8, border:'2px solid #0077b6', background:'#fff', color:'#0077b6', padding:'6px 18px', cursor:'pointer', marginTop:12}}
        >다음 문제</button>
      )}
      <div style={{marginTop:24, fontSize:18, color:'#0077b6'}}>점수: {score}</div>
    </div>
  );
}

// WordLevelPage, SentenceLevelPage에 시험 버튼 및 시험 모드 추가
function WordLevelPage({ words }) {
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [testMode, setTestMode] = useState(false);
  const filtered = selectedCategory
    ? words.filter(w => (w.level || w['분류'] || '').trim() === selectedCategory)
    : [];
  if (selectedCategory === null) {
    return <CategorySelect onSelect={setSelectedCategory} />;
  }
  if (!filtered.length) return <div>해당 카테고리에 단어가 없습니다.</div>;
  if (testMode) return <WordTest words={filtered} onExit={()=>setTestMode(false)} />;
  return (
    <div>
      <button onClick={() => setSelectedCategory(null)} style={{margin: 24, fontSize: 18, borderRadius: 8, border: '2px solid #61dafb', background: '#fff', color: '#0077b6', padding: '6px 18px', cursor: 'pointer'}}>← 카테고리 선택으로</button>
      <button onClick={() => setTestMode(true)} style={{margin: 24, fontSize: 18, borderRadius: 8, border: '2px solid #e67e22', background: '#fff', color: '#e67e22', padding: '6px 18px', cursor: 'pointer'}}>시험 보기</button>
      <SingleWordViewer words={filtered} />
    </div>
  );
}

function SentenceLevelPage({ sentences }) {
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [testMode, setTestMode] = useState(false);
  const filtered = selectedCategory
    ? sentences.filter(w => (w.level || w['분류'] || '').trim() === selectedCategory)
    : [];
  if (selectedCategory === null) {
    return <CategorySelect onSelect={setSelectedCategory} />;
  }
  if (!filtered.length) return <div>해당 카테고리에 문장이 없습니다.</div>;
  if (testMode) return <SentenceTest sentences={filtered} onExit={()=>setTestMode(false)} />;
  return (
    <div>
      <button onClick={() => setSelectedCategory(null)} style={{margin: 24, fontSize: 18, borderRadius: 8, border: '2px solid #61dafb', background: '#fff', color: '#0077b6', padding: '6px 18px', cursor: 'pointer'}}>← 카테고리 선택으로</button>
      <button onClick={() => setTestMode(true)} style={{margin: 24, fontSize: 18, borderRadius: 8, border: '2px solid #e67e22', background: '#fff', color: '#e67e22', padding: '6px 18px', cursor: 'pointer'}}>시험 보기</button>
      <SingleWordViewer words={filtered} />
    </div>
  );
}

// TypingPractice, TypingBattle 등에서도 단계 필터링을 카테고리명 필터링으로 변경
// TypingPractice
function TypingPractice({ data, type }) {
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [current, setCurrent] = useState(0);
  const [input, setInput] = useState('');
  const [startTime, setStartTime] = useState(null);
  const [endTime, setEndTime] = useState(null);
  const [result, setResult] = useState(null);
  const [score, setScore] = useState(0);
  const [history, setHistory] = useState([]);

  // 카테고리별 데이터 필터링
  const filtered = selectedCategory
    ? data.filter(w => (w.level || w['분류'] || '').trim() === selectedCategory)
    : [];
  const item = filtered[current];

  useEffect(() => {
    setInput('');
    setStartTime(null);
    setEndTime(null);
    setResult(null);
  }, [current, selectedCategory]);

  // 스페이스바로 정답 처리 및 자동 다음 문제
  useEffect(() => {
    const handleKey = (e) => {
      if (e.code === 'Space' && input === item?.chinese && !result) {
        handleComplete();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [input, item, result]);

  if (!data || data.length === 0) return <div>연습할 데이터가 없습니다.</div>;
  if (selectedCategory === null) {
    return <CategorySelect onSelect={setSelectedCategory} />;
  }
  if (!filtered.length) return <div>해당 카테고리에 데이터가 없습니다.</div>;
  if (!item) return null;

  const handleChange = (e) => {
    if (!startTime) setStartTime(Date.now());
    setInput(e.target.value);
  };

  const handleComplete = () => {
    if (input === item.chinese && !result) {
      const time = Date.now() - (startTime || Date.now());
      setEndTime(Date.now());
      setResult('정확하게 입력!');
      setScore(s => s + 1);
      setHistory(h => [...h, { sentence: item.chinese, time }]);
      setTimeout(() => {
        setCurrent((c) => (c + 1) % filtered.length);
      }, 1000);
    }
  };

  return (
    <div style={{maxWidth:600, margin:'40px auto', background:'#fff', borderRadius:16, boxShadow:'0 2px 16px #61dafb22', padding:32}}>
      <div style={{fontSize:28, marginBottom:16, color:'#0077b6'}}>{type === 'word' ? '중국어 단어 타자 연습' : '중국어 문장 타자 연습'}</div>
      <div style={{fontSize:22, marginBottom:12, color:'#222'}}>
        {item.chinese}
        {item.english && (
          <span style={{fontSize:18, color:'#888', marginLeft:12}}>
            (영어: {item.english})
          </span>
        )}
      </div>
      <input
        type="text"
        value={input}
        onChange={handleChange}
        style={{fontSize:22, width:'100%', padding:'10px 12px', borderRadius:8, border:'2px solid #61dafb', marginBottom:8}}
        placeholder={type === 'word' ? '위 단어를 똑같이 입력하세요' : '위 문장을 똑같이 입력하세요'}
        autoFocus
        onKeyDown={e => { if (e.code === 'Space' && input === item.chinese && !result) { e.preventDefault(); handleComplete(); } }}
      />
      {result && <div style={{color:'#38b000', fontSize:20, marginTop:8}}>{result} ({((endTime-startTime)/1000).toFixed(2)}초)</div>}
      <div style={{marginTop:18, fontSize:18, color:'#0077b6'}}>점수: {score}</div>
      <div style={{marginTop:24, fontSize:16, color:'#888'}}>
        <b>최근 기록</b><br/>
        {history.slice(-5).map((h,i)=>(<div key={i}>{h.sentence} - {(h.time/1000).toFixed(2)}초</div>))}
      </div>
      <button onClick={()=>setSelectedCategory(null)} style={{marginTop:24, fontSize:16, borderRadius:8, border:'2px solid #61dafb', background:'#fff', color:'#0077b6', padding:'6px 18px', cursor:'pointer'}}>← 카테고리 선택으로</button>
    </div>
  );
}

// TypingBattle
function TypingBattle({ sentences }) {
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [difficulty, setDifficulty] = useState('normal'); // 'easy' | 'normal' | 'hard'
  const [current, setCurrent] = useState(0);
  const [input, setInput] = useState('');
  const [aiInput, setAiInput] = useState('');
  const [aiProgress, setAiProgress] = useState(0);
  const [aiDone, setAiDone] = useState(false);
  const [startTime, setStartTime] = useState(null);
  const [endTime, setEndTime] = useState(null);
  const [result, setResult] = useState(null);
  const [score, setScore] = useState(0);
  const [aiScore, setAiScore] = useState(0);
  const [history, setHistory] = useState([]);

  // 카테고리별 문장 필터링
  const filtered = selectedCategory
    ? sentences.filter(w => (w.level || w['분류'] || '').trim() === selectedCategory)
    : [];
  const sentence = filtered[current];

  // 난이도별 AI 속도/오타율
  const aiConfig = {
    easy:   { speed: 180, typo: 0.12 },
    normal: { speed: 110, typo: 0.06 },
    hard:   { speed: 60,  typo: 0.02 },
  };
  const { speed: aiSpeedBase, typo: typoRate } = aiConfig[difficulty];

  useEffect(() => {
    if (!sentence) return;
    setAiInput('');
    setAiProgress(0);
    setAiDone(false);
    let idx = 0;
    function aiType() {
      if (!sentence.chinese || idx >= sentence.chinese.length) {
        setAiDone(true);
        return;
      }
      let nextChar = sentence.chinese[idx];
      if (Math.random() < typoRate) {
        // 오타: 임의의 한자(유니코드 범위 내) 삽입
        const randChar = String.fromCharCode(0x4e00 + Math.floor(Math.random() * (0x9fa5-0x4e00)));
        nextChar = randChar;
      }
      setAiInput(prev => prev + nextChar);
      setAiProgress(idx + 1);
      idx++;
      setTimeout(aiType, aiSpeedBase + Math.random() * 40, 0);
    }
    setTimeout(aiType, 600); // 약간의 딜레이 후 시작
    // eslint-disable-next-line
  }, [current, sentence, difficulty]);

  useEffect(() => {
    setInput('');
    setStartTime(null);
    setEndTime(null);
    setResult(null);
  }, [current, selectedCategory, difficulty]);

  useEffect(() => {
    if (aiDone && result === null) {
      setResult('AI 승리!');
      setAiScore(s => s + 1);
      setHistory(h => [...h, { sentence: sentence.chinese, winner: 'AI' }]);
      setTimeout(() => {
        setCurrent((c) => (c + 1) % filtered.length);
      }, 1200);
    }
    // eslint-disable-next-line
  }, [aiDone]);

  if (!sentences || sentences.length === 0) return <div>배틀할 문장이 없습니다.</div>;
  if (selectedCategory === null) {
    return <CategorySelect onSelect={setSelectedCategory} />;
  }
  if (!filtered.length) return <div>해당 카테고리에 문장이 없습니다.</div>;
  if (!sentence) return null;

  const handleChange = (e) => {
    if (!startTime) setStartTime(Date.now());
    setInput(e.target.value);
    if (e.target.value === sentence.chinese && result === null) {
      setEndTime(Date.now());
      if (!aiDone) {
        setResult('사용자 승리!');
        setScore(s => s + 1);
        setHistory(h => [...h, { sentence: sentence.chinese, winner: '사용자', time: Date.now() - startTime }]);
      } else {
        setResult('동시!');
        setScore(s => s + 1);
        setAiScore(s => s + 1);
        setHistory(h => [...h, { sentence: sentence.chinese, winner: '동시' }]);
      }
      setTimeout(() => {
        setCurrent((c) => (c + 1) % filtered.length);
      }, 1200);
    }
  };

  return (
    <div style={{maxWidth:700, margin:'40px auto', background:'#fff', borderRadius:16, boxShadow:'0 2px 16px #61dafb22', padding:32}}>
      <div style={{fontSize:28, marginBottom:16, color:'#d90429'}}>AI와 중국어 타자 배틀</div>
      <div style={{display:'flex', gap:16, marginBottom:18}}>
        <div>
          <b>난이도:</b>
          <select value={difficulty} onChange={e=>setDifficulty(e.target.value)} style={{marginLeft:8, fontSize:18, borderRadius:6, border:'1.5px solid #d90429', padding:'2px 10px'}}>
            <option value="easy">쉬움</option>
            <option value="normal">보통</option>
            <option value="hard">어려움</option>
          </select>
        </div>
        <button onClick={()=>setSelectedCategory(null)} style={{fontSize:16, borderRadius:8, border:'2px solid #61dafb', background:'#fff', color:'#0077b6', padding:'4px 14px', cursor:'pointer'}}>← 카테고리 선택</button>
      </div>
      <div style={{fontSize:22, marginBottom:12, color:'#222'}}>{sentence.chinese}</div>
      <div style={{display:'flex', gap:24, marginBottom:16}}>
        <div style={{flex:1}}>
          <div style={{fontWeight:700, color:'#0077b6', marginBottom:4}}>나</div>
          <input
            type="text"
            value={input}
            onChange={handleChange}
            style={{fontSize:22, width:'100%', padding:'10px 12px', borderRadius:8, border:'2px solid #61dafb', marginBottom:8}}
            placeholder="위 문장을 입력하세요"
            autoFocus
            disabled={!!result}
          />
        </div>
        <div style={{flex:1}}>
          <div style={{fontWeight:700, color:'#e63946', marginBottom:4}}>AI</div>
          <input
            type="text"
            value={aiInput}
            readOnly
            style={{fontSize:22, width:'100%', padding:'10px 12px', borderRadius:8, border:'2px solid #e63946', marginBottom:8, background:'#f8d7da', color:'#e63946'}}
          />
        </div>
      </div>
      {result && <div style={{color: result.includes('사용자') ? '#38b000' : '#e63946', fontSize:20, marginTop:8}}>{result}</div>}
      <div style={{marginTop:18, fontSize:18, color:'#0077b6'}}>내 점수: {score} &nbsp;|&nbsp; AI 점수: {aiScore}</div>
      <div style={{marginTop:24, fontSize:16, color:'#888'}}>
        <b>최근 배틀 기록</b><br/>
        {history.slice(-5).map((h,i)=>(<div key={i}>{h.sentence} - 승자: {h.winner}{h.time ? ` (${(h.time/1000).toFixed(2)}초)` : ''}</div>))}
      </div>
    </div>
  );
}

function WordQuizLevelPage({ words, onResult }) {
  const [selectedCategory, setSelectedCategory] = useState(null);
  const filtered = selectedCategory
    ? words.filter(w => (w.level || w['분류'] || '').trim() === selectedCategory)
    : [];
  if (selectedCategory === null) {
    return <CategorySelect onSelect={setSelectedCategory} />;
  }
  if (!filtered.length) return <div>해당 카테고리에 단어가 없습니다.</div>;
  return (
    <div>
      <button onClick={() => setSelectedCategory(null)} style={{margin: 24, fontSize: 18, borderRadius: 8, border: '2px solid #61dafb', background: '#fff', color: '#0077b6', padding: '6px 18px', cursor: 'pointer'}}>← 카테고리 선택으로</button>
      <Quiz words={filtered} onResult={onResult} />
    </div>
  );
}

function SentenceQuizLevelPage({ sentences, onResult }) {
  const [selectedCategory, setSelectedCategory] = useState(null);
  const filtered = selectedCategory
    ? sentences.filter(w => (w.level || w['분류'] || '').trim() === selectedCategory)
    : [];
  if (selectedCategory === null) {
    return <CategorySelect onSelect={setSelectedCategory} />;
  }
  if (!filtered.length) return <div>해당 카테고리에 문장이 없습니다.</div>;
  return (
    <div>
      <button onClick={() => setSelectedCategory(null)} style={{margin: 24, fontSize: 18, borderRadius: 8, border: '2px solid #61dafb', background: '#fff', color: '#0077b6', padding: '6px 18px', cursor: 'pointer'}}>← 카테고리 선택으로</button>
      <Quiz words={filtered} onResult={onResult} />
    </div>
  );
}

// 오답노트 복습 모드(단어)
function WordWrongNote({ wrongList, onExit }) {
  const [current, setCurrent] = React.useState(0);
  const [score, setScore] = React.useState(0);
  const [showResult, setShowResult] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const [selected, setSelected] = React.useState(null);
  const [input, setInput] = React.useState('');
  const [mode, setMode] = React.useState(Math.random() < 0.5 ? 'choice' : 'input');
  const total = wrongList.length;
  const word = wrongList[current];

  function getOptions(word, allWords, count = 4) {
    let candidates = allWords.filter(w => w.chinese !== word.chinese);
    let similar = candidates.sort(() => Math.random() - 0.5).slice(0, count - 1);
    const options = [word, ...similar].sort(() => Math.random() - 0.5);
    return options;
  }
  const options = word ? getOptions(word, wrongList, 4) : [];

  React.useEffect(() => {
    setMode(Math.random() < 0.5 ? 'choice' : 'input');
    setInput('');
    setSelected(null);
    setShowResult(false);
    setResult(null);
  }, [current]);

  if (!wrongList || wrongList.length === 0) return <div>오답이 없습니다.</div>;
  if (!word) return null;

  const handleChoice = (w) => {
    if (showResult) return;
    setSelected(w.chinese);
    const isCorrect = w.chinese === word.chinese;
    setResult(isCorrect ? '정답! 🎉' : '오답! 😢');
    setShowResult(true);
    if (isCorrect) setScore(s => s + 1);
    setTimeout(() => {
      setShowResult(false);
      setResult(null);
      setSelected(null);
      setCurrent((c) => (c + 1) % total);
    }, 1200);
  };

  const handleInput = () => {
    if (showResult) return;
    const isCorrect = input.trim() === word.chinese;
    setResult(isCorrect ? '정답! 🎉' : `오답! 정답: ${word.chinese}`);
    setShowResult(true);
    if (isCorrect) setScore(s => s + 1);
    setTimeout(() => {
      setShowResult(false);
      setResult(null);
      setInput('');
      setCurrent((c) => (c + 1) % total);
    }, 1500);
  };

  if (current === total - 1 && showResult) {
    return (
      <div style={{textAlign:'center', marginTop:40}}>
        <div style={{fontSize:28, marginBottom:16}}>오답노트 복습 종료!</div>
        <div style={{fontSize:22, marginBottom:12}}>점수: {score} / {total}</div>
        <button onClick={onExit} style={{fontSize:18, borderRadius:8, border:'2px solid #e67e22', background:'#fff', color:'#e67e22', padding:'8px 24px', cursor:'pointer'}}>카테고리로 돌아가기</button>
      </div>
    );
  }

  return (
    <div style={{textAlign:'center', marginTop:40}}>
      <div style={{fontSize:26, marginBottom:18}}>오답노트 복습 ({current+1} / {total})</div>
      {mode === 'choice' ? (
        <>
          <div style={{fontSize:22, marginBottom:12}}>{word.korean} (영어: {word.english})</div>
          <div style={{display:'flex', justifyContent:'center', gap:16, marginBottom:16}}>
            {options.map((w,idx)=>(
              <button key={idx} style={{fontSize:24, padding:'12px 32px', borderRadius:12, border:'2px solid #61dafb', background:selected===w.chinese?(w.chinese===word.chinese?'#b5ead7':'#ffd6fa'):'#fff', color:'#222', fontWeight:600, cursor:'pointer', transition:'all 0.18s'}} onClick={()=>handleChoice(w)}>{w.chinese}</button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div style={{fontSize:22, marginBottom:12}}>{word.english} ({word.korean})의 중국어는?</div>
          <input type="text" value={input} onChange={e=>setInput(e.target.value)} style={{fontSize:22, padding:'8px 18px', borderRadius:8, border:'2px solid #61dafb', marginBottom:8}} placeholder="중국어 입력" autoFocus onKeyDown={e=>{if(e.key==='Enter')handleInput();}} />
          <button onClick={handleInput} style={{fontSize:18, borderRadius:8, border:'2px solid #61dafb', background:'#fff', color:'#0077b6', padding:'6px 18px', cursor:'pointer', marginLeft:8}}>제출</button>
        </>
      )}
      {showResult && <div style={{fontSize:22, marginTop:16, color:result?.includes('정답')?'#38b000':'#e67e22', transition:'all 0.2s'}}>{result}</div>}
      {showResult && (
        <button onClick={() => {
          setShowResult(false);
          setResult(null);
          setSelected(null);
          setInput('');
          setCurrent((c) => (c + 1) % total);
        }}
        style={{fontSize:18, borderRadius:8, border:'2px solid #0077b6', background:'#fff', color:'#0077b6', padding:'6px 18px', cursor:'pointer', marginTop:12}}
        >다음 문제</button>
      )}
      <div style={{marginTop:24, fontSize:18, color:'#0077b6'}}>점수: {score}</div>
    </div>
  );
}

// 오답노트 복습 모드(문장)
function SentenceWrongNote({ wrongList, onExit }) {
  const [current, setCurrent] = React.useState(0);
  const [score, setScore] = React.useState(0);
  const [showResult, setShowResult] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const [selected, setSelected] = React.useState(null);
  const [input, setInput] = React.useState('');
  const [mode, setMode] = React.useState(Math.random() < 0.5 ? 'choice' : 'input');
  const total = wrongList.length;
  const sentence = wrongList[current];

  function getOptions(sentence, all, count=4) {
    let candidates = all.filter(w => w.chinese !== sentence.chinese);
    let similar = candidates.sort(() => Math.random() - 0.5).slice(0, count-1);
    const options = [sentence, ...similar].sort(() => Math.random() - 0.5);
    return options;
  }
  const options = sentence ? getOptions(sentence, wrongList, 4) : [];

  React.useEffect(() => {
    setMode(Math.random() < 0.5 ? 'choice' : 'input');
    setInput('');
    setSelected(null);
    setShowResult(false);
    setResult(null);
  }, [current]);

  if (!wrongList || wrongList.length === 0) return <div>오답이 없습니다.</div>;
  if (!sentence) return null;

  const handleChoice = (w) => {
    if (showResult) return;
    setSelected(w.chinese);
    const isCorrect = w.chinese === sentence.chinese;
    setResult(isCorrect ? '정답! 🎉' : '오답! 😢');
    setShowResult(true);
    if (isCorrect) setScore(s => s + 1);
    setTimeout(() => {
      setShowResult(false);
      setResult(null);
      setSelected(null);
      setCurrent((c) => (c + 1) % total);
    }, 1200);
  };

  const handleInput = () => {
    if (showResult) return;
    const isCorrect = input.trim() === sentence.chinese;
    setResult(isCorrect ? '정답! 🎉' : `오답! 정답: ${sentence.chinese}`);
    setShowResult(true);
    if (isCorrect) setScore(s => s + 1);
    setTimeout(() => {
      setShowResult(false);
      setResult(null);
      setInput('');
      setCurrent((c) => (c + 1) % total);
    }, 1500);
  };

  if (current === total - 1 && showResult) {
    return (
      <div style={{textAlign:'center', marginTop:40}}>
        <div style={{fontSize:28, marginBottom:16}}>오답노트 복습 종료!</div>
        <div style={{fontSize:22, marginBottom:12}}>점수: {score} / {total}</div>
        <button onClick={onExit} style={{fontSize:18, borderRadius:8, border:'2px solid #e67e22', background:'#fff', color:'#e67e22', padding:'8px 24px', cursor:'pointer'}}>카테고리로 돌아가기</button>
      </div>
    );
  }

  return (
    <div style={{textAlign:'center', marginTop:40}}>
      <div style={{fontSize:26, marginBottom:18}}>오답노트 복습 ({current+1} / {total})</div>
      {mode === 'choice' ? (
        <>
          <div style={{fontSize:22, marginBottom:12}}>{sentence.korean} (영어: {sentence.english})</div>
          <div style={{display:'flex', justifyContent:'center', gap:16, marginBottom:16}}>
            {options.map((w,idx)=>(
              <button key={idx} style={{fontSize:20, padding:'10px 24px', borderRadius:12, border:'2px solid #61dafb', background:selected===w.chinese?(w.chinese===sentence.chinese?'#b5ead7':'#ffd6fa'):'#fff', color:'#222', fontWeight:600, cursor:'pointer', transition:'all 0.18s'}} onClick={()=>handleChoice(w)}>{w.chinese}</button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div style={{fontSize:22, marginBottom:12}}>{sentence.english} ({sentence.korean})의 중국어는?</div>
          <input type="text" value={input} onChange={e=>setInput(e.target.value)} style={{fontSize:22, padding:'8px 18px', borderRadius:8, border:'2px solid #61dafb', marginBottom:8}} placeholder="중국어 입력" autoFocus onKeyDown={e=>{if(e.key==='Enter')handleInput();}} />
          <button onClick={handleInput} style={{fontSize:18, borderRadius:8, border:'2px solid #61dafb', background:'#fff', color:'#0077b6', padding:'6px 18px', cursor:'pointer', marginLeft:8}}>제출</button>
        </>
      )}
      {showResult && <div style={{fontSize:22, marginTop:16, color:result?.includes('정답')?'#38b000':'#e67e22', transition:'all 0.2s'}}>{result}</div>}
      {showResult && (
        <button onClick={() => {
          setShowResult(false);
          setResult(null);
          setSelected(null);
          setInput('');
          setCurrent((c) => (c + 1) % total);
        }}
        style={{fontSize:18, borderRadius:8, border:'2px solid #0077b6', background:'#fff', color:'#0077b6', padding:'6px 18px', cursor:'pointer', marginTop:12}}
        >다음 문제</button>
      )}
      <div style={{marginTop:24, fontSize:18, color:'#0077b6'}}>점수: {score}</div>
    </div>
  );
}

// 시험 기록 뷰
function HistoryView({ onBack, onRetryWrong }) {
  const [history, setHistory] = React.useState([]);
  React.useEffect(() => {
    const arr = JSON.parse(localStorage.getItem('testHistory') || '[]');
    setHistory(arr.reverse()); // 최신순
  }, []);
  if (!history.length) return <div style={{textAlign:'center',marginTop:60,fontSize:22}}>기록이 없습니다.</div>;
  return (
    <div style={{maxWidth:700,margin:'40px auto',background:'#fff',borderRadius:16,boxShadow:'0 2px 16px #61dafb22',padding:32}}>
      <button onClick={onBack} style={{marginBottom:24,fontSize:16,borderRadius:8,border:'2px solid #61dafb',background:'#fff',color:'#0077b6',padding:'6px 18px',cursor:'pointer'}}>← 돌아가기</button>
      <div style={{fontSize:28,marginBottom:18,color:'#0077b6'}}>내 시험 기록</div>
      <table style={{width:'100%',fontSize:16,borderCollapse:'collapse'}}>
        <thead><tr style={{background:'#f6f9fa'}}><th>날짜</th><th>카테고리</th><th>유형</th><th>점수</th><th>총문제</th><th>오답</th></tr></thead>
        <tbody>
          {history.map((h,i)=>(
            <tr key={i} style={{borderBottom:'1px solid #eee'}}>
              <td>{h.date}</td>
              <td>{h.category}</td>
              <td>{h.type==='word'?'단어':'문장'}</td>
              <td style={{color:'#38b000',fontWeight:600}}>{h.score}</td>
              <td>{h.total}</td>
              <td>
                <span
                  style={{color:'#e63946',fontWeight:600, cursor: h.wrongList?.length>0?'pointer':'default', textDecoration: h.wrongList?.length>0?'underline dotted':'none'}}
                  title={h.wrongList?.length>0? '오답만 다시 풀기':''}
                  onClick={()=>h.wrongList?.length>0 && onRetryWrong(h)}
                >{h.wrongList?.length||0}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
  const [showHistory, setShowHistory] = useState(false);
  const [retryWrongData, setRetryWrongData] = useState(null); // {type, wrongList, category}

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

  if (retryWrongData) {
    if (retryWrongData.type === 'word') {
      return <WordTest words={retryWrongData.wrongList} onResult={()=>setRetryWrongData(null)} />;
    } else {
      return <SentenceTest sentences={retryWrongData.wrongList} onExit={()=>setRetryWrongData(null)} />;
    }
  }

  return (
    <div className="App" style={{background: '#f6f9fa', minHeight: '100vh', margin: 0, padding: 0}}>
      <div style={{
        display: 'flex', justifyContent: 'center', gap: 16, margin: 24,
        position: 'sticky', top: 0, zIndex: 100, background: '#f6f9fa', boxShadow: '0 2px 8px #0001', paddingTop: 16, paddingBottom: 16
      }}>
        <button onClick={() => setView('wordCard')} style={{background:view==='wordCard'?'#0077b6':'#fff', color:view==='wordCard'?'#fff':'#0077b6', border:'2px solid #0077b6', borderRadius:8, padding:'8px 20px', fontSize:18, cursor:'pointer'}}>단어 카드</button>
        <button onClick={() => setView('wordQuiz')} style={{background:view==='wordQuiz'?'#0077b6':'#fff', color:view==='wordQuiz'?'#fff':'#0077b6', border:'2px solid #0077b6', borderRadius:8, padding:'8px 20px', fontSize:18, cursor:'pointer'}}>단어 퀴즈</button>
        <button onClick={() => setView('sentenceCard')} style={{background:view==='sentenceCard'?'#0077b6':'#fff', color:view==='sentenceCard'?'#fff':'#0077b6', border:'2px solid #0077b6', borderRadius:8, padding:'8px 20px', fontSize:18, cursor:'pointer'}}>문장 카드</button>
        <button onClick={() => setView('sentenceQuiz')} style={{background:view==='sentenceQuiz'?'#0077b6':'#fff', color:view==='sentenceQuiz'?'#fff':'#0077b6', border:'2px solid #0077b6', borderRadius:8, padding:'8px 20px', fontSize:18, cursor:'pointer'}}>문장 퀴즈</button>
        <button onClick={() => setView('typingPracticeWord')} style={{background:view==='typingPracticeWord'?'#ffb703':'#fff', color:view==='typingPracticeWord'?'#fff':'#ffb703', border:'2px solid #ffb703', borderRadius:8, padding:'8px 20px', fontSize:18, cursor:'pointer'}}>단어 타자 연습</button>
        <button onClick={() => setView('typingPracticeSentence')} style={{background:view==='typingPracticeSentence'?'#ffb703':'#fff', color:view==='typingPracticeSentence'?'#fff':'#ffb703', border:'2px solid #ffb703', borderRadius:8, padding:'8px 20px', fontSize:18, cursor:'pointer'}}>문장 타자 연습</button>
        <button onClick={() => setView('typingBattle')} style={{background:view==='typingBattle'?'#d90429':'#fff', color:view==='typingBattle'?'#fff':'#d90429', border:'2px solid #d90429', borderRadius:8, padding:'8px 20px', fontSize:18, cursor:'pointer'}}>타자 배틀</button>
        <button onClick={()=>setShowHistory(true)} style={{background:showHistory?'#38b000':'#fff', color:showHistory?'#fff':'#38b000', border:'2px solid #38b000', borderRadius:8, padding:'8px 20px', fontSize:18, cursor:'pointer'}}>내 시험 기록</button>
      </div>
      {showHistory ? (
        <HistoryView onBack={()=>setShowHistory(false)} onRetryWrong={(h)=>setRetryWrongData({type:h.type, wrongList:h.wrongList, category:h.category})} />
      ) : (
        <>
          {view === 'wordCard' && (
            <Section title="중국어 단어 카드" bg="#f6f9fa">
              <WordLevelPage words={wordCards} />
            </Section>
          )}
          {view === 'wordQuiz' && (
            <Section title="단어 퀴즈" bg="#e3f2fd">
              <WordQuizLevelPage words={wordCards} onResult={handleQuizResult} />
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
              <SentenceQuizLevelPage sentences={sentenceCards} onResult={handleQuizResultS} />
              <div style={{marginTop: 32, fontSize: 18, color: '#0077b6'}}>
                <b>학습 기록</b><br />
                전체 문제: {totalS} &nbsp;|&nbsp; 정답: {correctS} &nbsp;|&nbsp; 오답: {wrongS}
              </div>
            </Section>
          )}
          {view === 'typingPracticeWord' && (
            <Section title="중국어 단어 타자 연습 게임" bg="#fffde7">
              <TypingPractice data={wordCards} type="word" />
            </Section>
          )}
          {view === 'typingPracticeSentence' && (
            <Section title="중국어 문장 타자 연습 게임" bg="#fffde7">
              <TypingPractice data={sentenceCards} type="sentence" />
            </Section>
          )}
          {view === 'typingBattle' && (
            <Section title="AI와 중국어 타자 배틀 게임" bg="#fff0f3">
              <TypingBattle sentences={sentenceCards} />
            </Section>
          )}
        </>
      )}
    </div>
  );
}

export default App;
