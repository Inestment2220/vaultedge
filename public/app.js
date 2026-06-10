var LEVELS = [
  {level:1,  amount:5150,   profit:850,   rate:16.5, cycle:6, star:false},
  {level:2,  amount:20200,  profit:3750,  rate:18.6, cycle:6, star:false},
  {level:3,  amount:45000,  profit:9450,  rate:21.0, cycle:6, star:false},
  {level:4,  amount:79500,  profit:18690, rate:23.5, cycle:5, star:false},
  {level:5,  amount:124000, profit:32240, rate:26.0, cycle:5, star:true},
  {level:6,  amount:178000, profit:49840, rate:28.0, cycle:5, star:false},
  {level:7,  amount:242000, profit:72600, rate:30.0, cycle:4, star:false},
  {level:8,  amount:315500, profit:100960,rate:32.0, cycle:4, star:false},
  {level:9,  amount:399000, profit:135660,rate:34.0, cycle:4, star:false},
  {level:10, amount:492000, profit:177120,rate:36.0, cycle:4, star:true}
];

var REF_BONUS = 500;
var DAY_MS = 24 * 60 * 60 * 1000;
var currentUser = null;
var selectedLevel = null;
var payMethod = 'usdt';
var selectedWdMethod = 'usdt';

function getCycleMs(level) {
  for (var i = 0; i < LEVELS.length; i++) {
    if (LEVELS[i].level === level) return LEVELS[i].cycle * DAY_MS;
  }
  return 4 * DAY_MS;
}

function getCycleDays(level) {
  for (var i = 0; i < LEVELS.length; i++) {
    if (LEVELS[i].level === level) return LEVELS[i].cycle;
  }
  return 4;
}

function safeGet(key) { try { return JSON.parse(localStorage.getItem(key)); } catch(e) { return null; } }
function safeSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch(e) { return false; } return true; }
function safeRemove(key) { try { localStorage.removeItem(key); } catch(e) {} }

function getDatabase() { var db = safeGet('qumovcoin_db'); return (db && db.users) ? db : {users: []}; }
function saveDatabase(db) { safeSet('qumovcoin_db', db); }

function getUserData(email) {
  var d = safeGet('qumovcoin_data_' + email);
  return d || {investments:[], refBonus:0, referrals:[], withdrawn:0, withdrawalHistory:[]};
}
function saveUserData(email, data) {
  safeSet('qumovcoin_data_' + email, data);
}

function formatNaira(n) { return '\u20A6' + n.toLocaleString('en-NG'); }
function generateRefCode() { var c='QC',ch='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'; for(var i=0;i<6;i++) c+=ch.charAt(Math.floor(Math.random()*ch.length)); return c; }

function showToast(msg, type) {
  var icons = {ok:'fa-circle-check', err:'fa-circle-exclamation', info:'fa-circle-info'};
  var el = document.createElement('div');
  el.className = 'toast t-' + (type||'info');
  el.innerHTML = '<i class="fas '+(icons[type]||icons.info)+'"></i><span>'+msg+'</span>';
  document.getElementById('toastArea').appendChild(el);
  setTimeout(function(){ el.classList.add('hiding'); setTimeout(function(){ el.remove(); },300); }, 3500);
}

var fakeNames = ['Adebayo O.','Chioma N.','Emeka I.','Fatima Z.','Tunde A.','Blessing K.','Obinna M.','Aisha B.','Yusuf D.','Ngozi E.','Ibrahim T.','Sylvia U.','Chinedu W.','Halima R.','Kunle F.'];
var notifInterval = null;

function startNotifBar() {
  document.getElementById('notifBar').classList.add('on');
  addNotifItem();
  notifInterval = setInterval(addNotifItem, 4000);
}

function addNotifItem() {
  var track = document.getElementById('notifTrack');
  var name = fakeNames[Math.floor(Math.random()*fakeNames.length)];
  var lv = Math.floor(Math.random()*10)+1;
  var amt = LEVELS[lv-1].profit;
  var mins = Math.floor(Math.random()*30)+1;
  var item = document.createElement('span');
  item.className = 'notif-item';
  item.innerHTML = '<i class="fas fa-circle-check" style="color:var(--green);font-size:10px"></i>'
    + '<span class="ni-name">'+name+'</span>'
    + '<span style="color:var(--mut)">withdrew</span>'
    + '<span class="ni-amount">'+formatNaira(amt)+'</span>'
    + '<span class="ni-level">L'+lv+'</span>'
    + '<span class="ni-time">'+mins+'m ago</span>';
  track.appendChild(item);
  while (track.children.length > 15) track.removeChild(track.firstChild);
}

function showLogin() { document.getElementById('loginBox').style.display='block'; document.getElementById('registerBox').style.display='none'; }
function showRegister() { document.getElementById('loginBox').style.display='none'; document.getElementById('registerBox').style.display='block'; }
function toggleEye(id, btn) { var inp=document.getElementById(id),ic=btn.querySelector('i'); if(inp.type==='password'){inp.type='text';ic.className='fas fa-eye-slash'}else{inp.type='password';ic.className='fas fa-eye'} }

function validateReferral() {
  var code=document.getElementById('regReferral').value.trim().toUpperCase(), msg=document.getElementById('referralMsg');
  if(!code){msg.style.display='none';return}
  var db=getDatabase(),found=false;
  for(var i=0;i<db.users.length;i++){if(db.users[i].refCode===code){found=true;break;}}
  if(!found){msg.style.display='block';msg.style.color='var(--red)';msg.textContent='Invalid referral code'}
  else{msg.style.display='block';msg.style.color='var(--green)';msg.textContent='Valid! Bonus after first deposit.'}
}

function handleRegister() {
  var name=document.getElementById('regName').value.trim(), email=document.getElementById('regEmail').value.trim().toLowerCase(), phone=document.getElementById('regPhone').value.trim(), pass=document.getElementById('regPass').value, ref=document.getElementById('regReferral').value.trim().toUpperCase();
  if(!name||name.length<2){showToast('Enter your full name','err');return}
  if(!email||email.indexOf('@')<1){showToast('Enter a valid email','err');return}
  if(!phone||phone.length<10){showToast('Enter a valid phone','err');return}
  if(pass.length<6){showToast('Password min 6 characters','err');return}
  var db=getDatabase();
  for(var i=0;i<db.users.length;i++){if(db.users[i].email===email){showToast('Email already registered','err');return}}
  var refEmail=null;
  if(ref){for(var j=0;j<db.users.length;j++){if(db.users[j].refCode===ref){refEmail=db.users[j].email;break;}} if(!refEmail){showToast('Invalid referral code','err');return}}
  var rc=generateRefCode();
  db.users.push({name:name,email:email,phone:phone,password:pass,refCode:rc}); saveDatabase(db);
  saveUserData(email,{investments:[],refBonus:0,referrals:[],withdrawn:0,withdrawalHistory:[]});
  if(refEmail){var rd=getUserData(refEmail);rd.refBonus+=REF_BONUS;rd.referrals.push({name:name,date:Date.now(),amount:REF_BONUS});saveUserData(refEmail,rd)}
  showToast('Account created! Please sign in.','ok'); showLogin(); document.getElementById('loginEmail').value=email;
}

function handleLogin() {
  var email=document.getElementById('loginEmail').value.trim().toLowerCase(), pass=document.getElementById('loginPass').value;
  if(!email||!pass){showToast('Enter email and password','err');return}
  var db=getDatabase(), user=null;
  for(var i=0;i<db.users.length;i++){if(db.users[i].email===email){user=db.users[i];break;}}
  if(!user){showToast('No account with this email','err');return}
  if(user.password!==pass){showToast('Incorrect password','err');return}
  currentUser=user; safeSet('qumovcoin_session',email); enterApp();
  showToast('Welcome back, '+user.name.split(' ')[0]+'!','ok');
}

function handleLogout() {
  safeRemove('qumovcoin_session');
  if(notifInterval){clearInterval(notifInterval);notifInterval=null}
  document.getElementById('notifBar').classList.remove('on');
  currentUser=null;
  document.getElementById('mainApp').classList.remove('on');
  document.getElementById('bottomNav').classList.remove('on');
  document.getElementById('authScreen').classList.remove('off');
  document.getElementById('loginEmail').value=''; document.getElementById('loginPass').value='';
  closeModal('modalLogout'); showToast('Logged out','info');
}

function enterApp() {
  document.getElementById('authScreen').classList.add('off');
  document.getElementById('mainApp').classList.add('on');
  document.getElementById('bottomNav').classList.add('on');
  var ini=currentUser.name.charAt(0).toUpperCase();
  document.getElementById('avatarHome').textContent=ini;
  document.getElementById('avatarSettings').textContent=ini;
  document.getElementById('settingsName').textContent=currentUser.name;
  document.getElementById('settingsEmail').textContent=currentUser.email;
  document.getElementById('myRefCode').value=currentUser.refCode;
  renderLevels(); refreshDashboard(); navigateTo('pageHome');
  startNotifBar();
}

function navigateTo(pageId) {
  var pages=document.querySelectorAll('.page'); for(var i=0;i<pages.length;i++) pages[i].classList.remove('on');
  document.getElementById(pageId).classList.add('on');
  var btns=document.querySelectorAll('.nav-btn'); for(var j=0;j<btns.length;j++) btns[j].classList.toggle('on',btns[j].getAttribute('data-page')===pageId);
  window.scrollTo({top:0,behavior:'smooth'});
  if(pageId==='pagePortfolio'||pageId==='pageHome') refreshDashboard();
  if(pageId==='pageRefer') refreshReferral();
  if(pageId==='pageWithdraw') refreshWithdrawPage();
}

function renderLevels() {
  var html='';
  for(var i=0;i<LEVELS.length;i++){
    var l=LEVELS[i];
    var canWithdraw = l.level<=3;
    html+='<div class="lv-card '+(l.star?'star':'')+'" onclick="openDeposit('+l.level+')">'
      +'<div class="lv-bg">'+String(l.level).padStart(2,'0')+'</div>'
      +'<span class="lv-tag">Level '+l.level+'</span>'
      +'<div class="lv-inv-label">Investment Amount</div>'
      +'<div class="lv-inv-amt"><span class="naira">&#8358;</span>'+l.amount.toLocaleString('en-NG')+'</div>'
      +'<div class="lv-details">'
      +'<div class="lv-det"><div class="det-label">Profit / Cycle</div><div class="det-val">&#8358;'+l.profit.toLocaleString('en-NG')+'</div></div>'
      +'<div class="lv-det"><div class="det-label">Rate</div><div class="det-val gd">'+l.rate+'%</div></div>'
      +'<div class="lv-det"><div class="det-label">Monthly Est.</div><div class="det-val">&#8358;'+Math.round(l.profit*(30/l.cycle)).toLocaleString('en-NG')+'</div></div>'
      +'</div>'
      +'<div class="lv-cycle"><i class="fas fa-clock"></i> Payout every '+l.cycle+' days'+(canWithdraw?' &middot; <span style="color:var(--green)">Withdrawable</span>':'')+'</div>'
      +'<button class="btn btn-gold btn-sm">Invest Now</button>'
      +'</div>';
  }
  document.getElementById('levelsGrid').innerHTML=html;
}

function openDeposit(levelNum) {
  for(var i=0;i<LEVELS.length;i++){if(LEVELS[i].level===levelNum){selectedLevel=LEVELS[i];break;}}
  if(!selectedLevel) return;
  document.getElementById('depPlan').textContent='Level '+selectedLevel.level;
  document.getElementById('depAmount').textContent=formatNaira(selectedLevel.amount);
  document.getElementById('depProfit').textContent=formatNaira(selectedLevel.profit);
  document.getElementById('depCycle').textContent=selectedLevel.cycle+' days';
  document.getElementById('depRate').textContent=selectedLevel.rate+'%';
  document.getElementById('bankAmount').textContent=formatNaira(selectedLevel.amount);
  document.getElementById('proofFileName').textContent='';
  document.getElementById('proofFile').value='';
  switchPay('usdt');
  openModal('modalDeposit');
}

// ===== PLISIO INTEGRATION =====
var activeTxnId = null;
var plisioPollInterval = null;

function stopPlisioPoll() {
  if (plisioPollInterval) { clearInterval(plisioPollInterval); plisioPollInterval = null; }
}

function pollPlisioStatus(txnId, levelNum, amount) {
  stopPlisioPoll();
  plisioPollInterval = setInterval(function() {
    fetch('/api/invoice-status?txn_id=' + txnId)
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (res.status === 'success' && res.data) {
          if (res.data.status === 'paid') {
            stopPlisioPoll();
            var ud = getUserData(currentUser.email), now = Date.now();
            var lvData = null;
            for (var i = 0; i < LEVELS.length; i++) { if (LEVELS[i].level === levelNum) { lvData = LEVELS[i]; break; } }
            if (lvData) {
              ud.investments.push({
                id: now, level: levelNum, amount: amount,
                profit: lvData.profit, rate: lvData.rate,
                startTime: now, nextPayout: now + getCycleMs(levelNum),
                cycles: 0, earned: 0, status: 'active'
              });
              saveUserData(currentUser.email, ud);
            }
            closeModal('modalDeposit');
            showToast('Level ' + levelNum + ' — ' + formatNaira(amount) + ' invested! Payment confirmed.','ok');
            document.getElementById('depositBtn').innerHTML = '<i class="fas fa-lock"></i> Confirm Payment';
            document.getElementById('depositBtn').disabled = false;
            document.getElementById('depositBtn').style.opacity = '1';
            refreshDashboard();
            setTimeout(function() { navigateTo('pagePortfolio'); }, 300);
          } else if (res.data.status === 'expired') {
            stopPlisioPoll();
            showToast('Payment invoice expired. Please try again.','err');
            document.getElementById('depositBtn').innerHTML = '<i class="fas fa-lock"></i> Confirm Payment';
            document.getElementById('depositBtn').disabled = false;
            document.getElementById('depositBtn').style.opacity = '1';
          }
        }
      })
      .catch(function() {});
  }, 5000);
}

function createPlisioInvoice(cryptoType) {
  if (!selectedLevel || !currentUser) return;
  var loadingEl = document.getElementById(cryptoType === 'usdt' ? 'usdtLoading' : 'btcLoading');
  var infoEl = document.getElementById(cryptoType === 'usdt' ? 'usdtPaymentInfo' : 'btcPaymentInfo');
  loadingEl.style.display = 'block';
  infoEl.style.display = 'none';

  fetch('/api/create-invoice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: currentUser.email,
      level: selectedLevel.level,
      amountNGN: selectedLevel.amount,
      cryptoType: cryptoType
    })
  })
  .then(function(r) { return r.json(); })
  .then(function(res) {
    loadingEl.style.display = 'none';
    if (res.status === 'success' && res.data) {
      activeTxnId = res.data.txn_id;
      var addrEl = document.getElementById(cryptoType === 'usdt' ? 'plisioUsdtAddr' : 'plisioBtcAddr');
      var amtEl = document.getElementById(cryptoType === 'usdt' ? 'plisioUsdtAmt' : 'plisioBtcAmt');
      var expEl = document.getElementById(cryptoType === 'usdt' ? 'plisioUsdtExp' : 'plisioBtcExp');
      var urlEl = document.getElementById(cryptoType === 'usdt' ? 'plisioUsdtUrl' : 'plisioBtcUrl');
      addrEl.value = res.data.wallet_hash;
      amtEl.textContent = res.data.amount_crypto + ' ' + res.data.currency;
      expEl.textContent = res.data.expire_min + ' minutes';
      urlEl.value = res.data.invoice_url;
      infoEl.style.display = 'block';
      pollPlisioStatus(res.data.txn_id, selectedLevel.level, selectedLevel.amount);
    } else {
      infoEl.style.display = 'none';
      showToast(res.message || 'Failed to create payment invoice','err');
    }
  })
  .catch(function() {
    loadingEl.style.display = 'none';
    showToast('Network error. Please try again.','err');
  });
}

// ===== DEPOSIT FUNCTIONS (updated) =====
function switchPay(m) {
  payMethod = m;
  stopPlisioPoll();
  var tabs = document.querySelectorAll('#payTabs .pay-tab');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('on', tabs[i].getAttribute('data-m') === m);
  document.getElementById('payUsdt').style.display = m === 'usdt' ? 'block' : 'none';
  document.getElementById('payBtc').style.display = m === 'btc' ? 'block' : 'none';
  document.getElementById('payBank').style.display = m === 'bank' ? 'block' : 'none';
  // Reset crypto panels
  document.getElementById('usdtLoading').style.display = 'none';
  document.getElementById('usdtPaymentInfo').style.display = 'none';
  document.getElementById('btcLoading').style.display = 'none';
  document.getElementById('btcPaymentInfo').style.display = 'none';
}

function processDeposit() {
  if (!selectedLevel || !currentUser) return;
  if (payMethod === 'bank') {
    if (!document.getElementById('proofFile').files.length) { showToast('Upload payment proof', 'err'); return; }
    var btn = document.getElementById('depositBtn');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...'; btn.disabled = true; btn.style.opacity = '0.7';
    setTimeout(function() {
      var ud = getUserData(currentUser.email), now = Date.now();
      ud.investments.push({ id: now, level: selectedLevel.level, amount: selectedLevel.amount, profit: selectedLevel.profit, rate: selectedLevel.rate, startTime: now, nextPayout: now + getCycleMs(selectedLevel.level), cycles: 0, earned: 0, status: 'active' });
      saveUserData(currentUser.email, ud);
      closeModal('modalDeposit');
      showToast('Level ' + selectedLevel.level + ' — ' + formatNaira(selectedLevel.amount) + ' invested! Awaiting confirmation.', 'ok');
      btn.innerHTML = '<i class="fas fa-lock"></i> Confirm Payment'; btn.disabled = false; btn.style.opacity = '1';
      refreshDashboard();
      setTimeout(function() { navigateTo('pagePortfolio'); }, 300);
    }, 2200);
  } else {
    // Crypto payment via Plisio
    createPlisioInvoice(payMethod);
  }
}

function getWithdrawableProfit() {
  if(!currentUser) return 0;
  var ud=getUserData(currentUser.email), total=0;
  for(var i=0;i<ud.investments.length;i++){
    var inv=ud.investments[i];
    if(inv.level<=3 && inv.earned>0) total+=inv.earned;
  }
  return total - (ud.withdrawn||0);
}

function openWithdrawModal() {
  var avail=getWithdrawableProfit();
  document.getElementById('wdBalance').textContent=formatNaira(Math.max(0,avail));
  document.getElementById('wdWallet').value='';
  document.getElementById('wdBankName').value='';
  document.getElementById('wdAcctNum').value='';
  document.getElementById('wdAcctName').value='';
  updateWithdrawUI();
  openModal('modalWithdraw');
}

function updateWithdrawUI() {
  var m=document.getElementById('wdMethod').value;
  document.getElementById('wdCryptoFields').style.display=(m==='usdt'||m==='btc')?'block':'none';
  document.getElementById('wdBankFields').style.display=m==='bank'?'block':'none';
  var ph = m==='usdt'?'Enter your USDT TRC20 address':m==='btc'?'Enter your BTC address':'';
  document.getElementById('wdWallet').placeholder=ph;
}

function processWithdraw() {
  var avail=getWithdrawableProfit();
  if(avail<=0){showToast('No withdrawable profit available','err');return}
  var m=document.getElementById('wdMethod').value;
  if(m==='usdt'||m==='btc'){
    var addr=document.getElementById('wdWallet').value.trim();
    if(!addr||addr.length<10){showToast('Enter a valid wallet address','err');return}
  } else {
    var bn=document.getElementById('wdBankName').value.trim();
    var an=document.getElementById('wdAcctNum').value.trim();
    var aname=document.getElementById('wdAcctName').value.trim();
    if(!bn||!an||!aname){showToast('Fill in all bank details','err');return}
  }
  var btn=document.getElementById('withdrawBtn');
  btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Processing...'; btn.disabled=true; btn.style.opacity='0.7';
  setTimeout(function(){
    var ud=getUserData(currentUser.email);
    var details = m==='usdt'||m==='btc' ? {address:document.getElementById('wdWallet').value.trim()} : {bank:document.getElementById('wdBankName').value.trim(),acctNum:document.getElementById('wdAcctNum').value.trim(),acctName:document.getElementById('wdAcctName').value.trim()};
    if(!ud.withdrawalHistory) ud.withdrawalHistory=[];
    ud.withdrawalHistory.unshift({id:Date.now(),amount:avail,method:m,details:details,status:'pending',date:Date.now()});
    ud.withdrawn=(ud.withdrawn||0)+avail;
    saveUserData(currentUser.email,ud);
    closeModal('modalWithdraw');
    showToast('Withdrawal of '+formatNaira(avail)+' submitted! Processing in 24-48 hours.','ok');
    btn.innerHTML='<i class="fas fa-paper-plane"></i> Submit Withdrawal'; btn.disabled=false; btn.style.opacity='1';
    refreshDashboard();
  },2500);
}

function selectWdMethod(method) {
  selectedWdMethod = method;
  var cards = document.querySelectorAll('.wd-method-card');
  for(var i=0;i<cards.length;i++) cards[i].classList.toggle('on', cards[i].getAttribute('data-method')===method);
  document.getElementById('wdPageCryptoFields').style.display = (method==='usdt'||method==='btc') ? 'block' : 'none';
  document.getElementById('wdPageBankFields').style.display = method==='bank' ? 'block' : 'none';
  var ph = method==='usdt' ? 'Enter your USDT TRC20 address' : method==='btc' ? 'Enter your BTC address' : '';
  document.getElementById('wdPageWallet').placeholder = ph;
}

function refreshWithdrawPage() {
  if(!currentUser) return;
  var avail = getWithdrawableProfit();
  document.getElementById('wdPageBalance').textContent = formatNaira(Math.max(0, avail));
  renderWithdrawHistory();
}

function renderWithdrawHistory() {
  if(!currentUser) return;
  var ud = getUserData(currentUser.email);
  var el = document.getElementById('wdHistoryList');
  if(!ud.withdrawalHistory || !ud.withdrawalHistory.length) {
    el.innerHTML = '<div class="empty-state" style="padding:32px 16px"><i class="fas fa-clock-rotate-left"></i><p>No withdrawal history yet.</p></div>';
    return;
  }
  var html = '';
  var methodIcons = {usdt:'fab fa-bitcoin',btc:'fab fa-bitcoin',bank:'fas fa-building-columns'};
  var methodColors = {usdt:'var(--usdt)',btc:'var(--btc)',bank:'var(--blue)'};
  var methodNames = {usdt:'USDT (TRC20)',btc:'Bitcoin',bank:'Bank Transfer'};
  for(var i=0;i<ud.withdrawalHistory.length;i++) {
    var w = ud.withdrawalHistory[i];
    var isPending = w.status==='pending';
    var iconClass = isPending ? 'pending' : 'completed';
    var dateStr = new Date(w.date).toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'numeric'});
    var timeStr = new Date(w.date).toLocaleTimeString('en-NG',{hour:'2-digit',minute:'2-digit'});
    html += '<div class="wd-hist-item">'
      + '<div class="wd-hist-left">'
      + '<div class="wd-hist-icon '+iconClass+'"><i class="'+(methodIcons[w.method]||'fas fa-wallet')+'" style="color:'+(methodColors[w.method]||'var(--gold)')+'"></i></div>'
      + '<div class="wd-hist-info"><h5>'+formatNaira(w.amount)+'</h5><p>'+methodNames[w.method]+' &middot; '+dateStr+' '+timeStr+'</p></div>'
      + '</div>'
      + '<div class="wd-hist-right">'
      + '<div class="wd-hist-amount '+iconClass+'">'+formatNaira(w.amount)+'</div>'
      + '<div class="wd-hist-status '+iconClass+'">'+(isPending?'<i class="fas fa-clock" style="font-size:10px;margin-right:3px"></i>Pending':'<i class="fas fa-check-circle" style="font-size:10px;margin-right:3px"></i>Completed')+'</div>'
      + '</div>'
      + '</div>';
  }
  el.innerHTML = html;
}

function processPageWithdraw() {
  var avail = getWithdrawableProfit();
  if(avail<=0) {
    showToast('No withdrawable profit available','err');
    return;
  }
  var details = {};
  if(selectedWdMethod==='usdt'||selectedWdMethod==='btc') {
    var addr = document.getElementById('wdPageWallet').value.trim();
    if(!addr||addr.length<10) {
      showToast('Enter a valid wallet address','err');
      return;
    }
    details = {address: addr};
  } else {
    var bn = document.getElementById('wdPageBankName').value.trim();
    var an = document.getElementById('wdPageAcctNum').value.trim();
    var aname = document.getElementById('wdPageAcctName').value.trim();
    if(!bn||!an||!aname) {
      showToast('Fill in all bank details','err');
      return;
    }
    if(an.length<10) {
      showToast('Enter a valid 10-digit account number','err');
      return;
    }
    details = {bank: bn, acctNum: an, acctName: aname};
  }
  var btn = document.getElementById('wdPageSubmitBtn');
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
  btn.disabled = true;
  btn.style.opacity = '0.7';
  setTimeout(function(){
    var ud = getUserData(currentUser.email);
    if(!ud.withdrawalHistory) ud.withdrawalHistory = [];
    ud.withdrawalHistory.unshift({
      id: Date.now(),
      amount: avail,
      method: selectedWdMethod,
      details: details,
      status: 'pending',
      date: Date.now()
    });
    ud.withdrawn = (ud.withdrawn||0) + avail;
    saveUserData(currentUser.email, ud);
    btn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit Withdrawal';
    btn.disabled = false;
    btn.style.opacity = '1';
    showToast('Withdrawal of '+formatNaira(avail)+' submitted! Processing in 24-48 hours.','ok');
    document.getElementById('wdPageWallet').value = '';
    document.getElementById('wdPageBankName').value = '';
    document.getElementById('wdPageAcctNum').value = '';
    document.getElementById('wdPageAcctName').value = '';
    refreshWithdrawPage();
    refreshDashboard();
  }, 2500);
}

function refreshDashboard() {
  if(!currentUser) return;
  var ud=getUserData(currentUser.email); if(!ud) return;
  var totalInv=0,totalEarn=0;
  for(var i=0;i<ud.investments.length;i++){totalInv+=ud.investments[i].amount;totalEarn+=ud.investments[i].earned;}
  document.getElementById('homeBalance').textContent=formatNaira(totalInv+totalEarn+ud.refBonus);
  document.getElementById('homeInvested').textContent=formatNaira(totalInv);
  document.getElementById('homeEarned').textContent=formatNaira(totalEarn);
  document.getElementById('homeRefBonus').textContent=formatNaira(ud.refBonus);
  document.getElementById('portInvested').textContent=formatNaira(totalInv);
  document.getElementById('portEarned').textContent=formatNaira(totalEarn);

  var activeCount=0;
  for(var j=0;j<ud.investments.length;j++){if(ud.investments[j].status==='active')activeCount++;}
  document.getElementById('portDot').style.display=activeCount>0?'block':'none';

  var wAvail=getWithdrawableProfit();
  var hasL13=false;
  for(var k=0;k<ud.investments.length;k++){if(ud.investments[k].level<=3){hasL13=true;break;}}
  document.getElementById('withdrawSection').style.display=hasL13?'block':'none';
  document.getElementById('withdrawAvailable').textContent=formatNaira(Math.max(0,wAvail));

  renderInvestmentList('homeInvestList',ud.investments.slice(0,3));
  renderInvestmentList('portInvestList',ud.investments);
}

function renderInvestmentList(containerId,list) {
  var el=document.getElementById(containerId);
  if(!list.length){el.innerHTML='<div class="empty-state"><i class="fas fa-inbox"></i><p>'+(containerId==='homeInvestList'?'No active investments yet.<br>Choose a plan to get started.':'You haven\'t invested yet.')+'</p></div>';return;}
  var html='<div class="inv-list">';
  for(var i=0;i<list.length;i++){
    var inv=list[i], rem=Math.max(0,inv.nextPayout-Date.now());
    var d=Math.floor(rem/86400000),h=Math.floor((rem%86400000)/3600000),m=Math.floor((rem%3600000)/60000),s=Math.floor((rem%60000)/1000);
    var timer=d+'d '+String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
    var cycleDays=getCycleDays(inv.level);
    var canWd=inv.level<=3;
    html+='<div class="inv-item"><div class="inv-left"><div class="inv-ico">L'+inv.level+'</div><div class="inv-info"><h4>Level '+inv.level+' Plan</h4><p>'+formatNaira(inv.amount)+' &middot; '+inv.cycles+' cycles &middot; '+cycleDays+'d cycle</p></div></div><div class="inv-right"><div class="inv-profit">+'+formatNaira(inv.earned)+'</div><div class="inv-timer" data-end="'+inv.nextPayout+'">'+timer+'</div>'
      +(canWd&&inv.earned>0?'<button class="btn btn-green btn-xs inv-withdraw" onclick="navigateTo(\'pageWithdraw\')"><i class="fas fa-arrow-right-from-bracket"></i> Withdraw</button>':'')
      +'<span class="status-active"><span class="status-dot"></span> Active</span></div></div>';
  }
  html+='</div>';
  el.innerHTML=html;
}

function tickCountdowns() {
  if(!currentUser) return;
  var ud=getUserData(currentUser.email); if(!ud) return;
  var changed=false;
  for(var i=0;i<ud.investments.length;i++){
    var inv=ud.investments[i]; if(inv.status!=='active') continue;
    if(inv.nextPayout-Date.now()<=0){
      inv.cycles++; inv.earned+=inv.profit; inv.nextPayout=Date.now()+getCycleMs(inv.level); changed=true;
      showToast('Level '+inv.level+' payout: +'+formatNaira(inv.profit),'ok');
    }
  }
  if(changed){saveUserData(currentUser.email,ud);refreshDashboard();}
  var timers=document.querySelectorAll('.inv-timer[data-end]');
  for(var j=0;j<timers.length;j++){
    var r=Math.max(0,parseInt(timers[j].getAttribute('data-end'))-Date.now());
    var dd=Math.floor(r/86400000),hh=Math.floor((r%86400000)/3600000),mm=Math.floor((r%3600000)/60000),ss=Math.floor((r%60000)/1000);
    timers[j].textContent=r>0?dd+'d '+String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0')+':'+String(ss).padStart(2,'0'):'Claiming...';
  }
}

function refreshReferral() {
  if(!currentUser) return;
  var ud=getUserData(currentUser.email); if(!ud) return;
  document.getElementById('refCount').textContent=ud.referrals.length;
  document.getElementById('refEarnings').textContent=formatNaira(ud.refBonus);
  var el=document.getElementById('refHistoryList');
  if(!ud.referrals.length){el.innerHTML='<div class="empty-state" style="padding:32px 16px"><i class="fas fa-users"></i><p>No referrals yet.</p></div>';return;}
  var html='';
  for(var i=ud.referrals.length-1;i>=0;i--){
    var r=ud.referrals[i];
    html+='<div class="ref-hist-item"><div><div class="rh-name">'+r.name+'</div><div class="rh-date">'+new Date(r.date).toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'numeric'})+'</div></div><div class="rh-amt">+'+formatNaira(r.amount)+'</div></div>';
  }
  el.innerHTML=html;
}

function copyText(t){if(navigator.clipboard)navigator.clipboard.writeText(t).then(function(){showToast('Copied!','ok')}).catch(function(){showToast('Copy failed','err')});else showToast('Copy not supported','err')}
function shareReferral(){var c=document.getElementById('myRefCode').value,t='Join Qumovcoin and earn every cycle! Code: '+c;if(navigator.share)navigator.share({title:'Qumovcoin',text:t}).catch(function(){});else copyText(t)}

function prefillProfile(){if(!currentUser)return;document.getElementById('editName').value=currentUser.name;document.getElementById('editPhone').value=currentUser.phone}
function saveProfile(){
  var n=document.getElementById('editName').value.trim(),p=document.getElementById('editPhone').value.trim();
  if(!n||n.length<2){showToast('Name required','err');return}
  if(!p||p.length<10){showToast('Valid phone required','err');return}
  var db=getDatabase();for(var i=0;i<db.users.length;i++){if(db.users[i].email===currentUser.email){db.users[i].name=n;db.users[i].phone=p;break;}}saveDatabase(db)
  currentUser.name=n;currentUser.phone=p;
  var ini=n.charAt(0).toUpperCase();
  document.getElementById('avatarHome').textContent=ini;document.getElementById('avatarSettings').textContent=ini;document.getElementById('settingsName').textContent=n;
  closeModal('modalProfile');showToast('Profile updated','ok');
}
function savePassword(){
  var c=document.getElementById('pwCurrent').value,n=document.getElementById('pwNew').value,f=document.getElementById('pwConfirm').value;
  if(!c){showToast('Enter current password','err');return}
  if(c!==currentUser.password){showToast('Incorrect password','err');return}
  if(n.length<6){showToast('Min 6 characters','err');return}
  if(n!==f){showToast('Passwords don\'t match','err');return}
  var db=getDatabase();for(var i=0;i<db.users.length;i++){if(db.users[i].email===currentUser.email){db.users[i].password=n;break;}}saveDatabase(db)
  currentUser.password=n;closeModal('modalPassword');showToast('Password changed','ok');
}

function openModal(id){document.getElementById(id).classList.add('on');document.body.style.overflow='hidden'}
function closeModal(id) {
  document.getElementById(id).classList.remove('on');
  if (!document.querySelector('.modal-bg.on')) document.body.style.overflow = '';
  if (id === 'modalDeposit') stopPlisioPoll();
}
var allModals=document.querySelectorAll('.modal-bg');
for(var mi=0;mi<allModals.length;mi++){(function(modal){modal.addEventListener('click',function(e){if(e.target===modal)closeModal(modal.id)})})(allModals[mi])}
document.addEventListener('keydown',function(e){if(e.key==='Escape'){var o=document.querySelector('.modal-bg.on');if(o)closeModal(o.id)}});

(function(){
  setInterval(tickCountdowns,1000);
  var saved=safeGet('qumovcoin_session');
  if(saved&&typeof saved==='string'){
    var db=getDatabase();
    for(var i=0;i<db.users.length;i++){
      if(db.users[i].email===saved){currentUser=db.users[i];enterApp();return;}
    }
  }
  document.getElementById('authScreen').classList.remove('off');
})();