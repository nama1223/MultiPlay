/* MultiPlay 用チュートリアル設定（NamaTutorial キット v1）
   キャラの口調: 基本は丁寧語。文末は「です」「ます」の代わりに「ナマ」を語幹へ直接付ける（規格参照）
   ページID: files=曲一覧 / player=プレイヤー(再生) / player-edit=プレイヤー(編集) / player-settings=プレイヤー(設定)
   橋渡し（src/App.tsx の MultiPlayTutorialBridge）がモード切替まで面倒を見る
   管理者専用機能（曲データの編集・トラック管理・管理画面）はこの案内では扱わない */
window.NAMA_TUTORIAL_CONFIG = {
  appId: 'multiplay',
  assetBase: 'tutorial/img/',
  buttonImage: 'tutorial/img/tutorial-button.png',
  buttonPages: ['files', 'player', 'player-edit', 'player-settings'], // ログイン画面と管理画面には出さない
  startWithCurrentChapter: true, // 初回は「今いる画面の章」から始める（曲リンクでプレイヤーへ直行する人が多いため）
  bridge: 'MultiPlayTutorialBridge',
  introTitle: 'MultiPlayの使い方',
  introText: 'パート別の音源を重ねて聴けるプレイヤーナマ。自分のパートだけ大きくしたり、速度を落として練習したりするやり方を案内しナマ。',
  chapters: [
    {
      id: 'files', page: 'files', title: 'はじめに', desc: '団体と曲の選び方', icon: 'wave', since: 2,
      steps: [
        { pose: 'wave', text: 'やあ！生物（ナマモノ）ナマ。MultiPlayの案内役ナマ。この章では、団体と曲の選び方を案内しナマ。先に言っておくと、この案内はいつでも✕ボタンでやめられるし、やめた後も右下のボタンから見直せナマ。' },
        { pose: 'thinking', text: 'MultiPlayは団体ごとに曲が分かれているナマ。初めての時は、最初の画面で自分の団体を選んで入るナマ。もう入っている時は、そのまま曲の一覧から始められるナマ。曲のリンクをもらった時は、この画面を飛ばして直接プレイヤーが開くこともあるナマ。' },
        { target: '.change-btn', pose: 'point', text: '団体を間違えた時や、別の団体へ移る時は、この「戻る」から最初の画面に戻れるナマ。' },
        { target: '.file-item-btn', mode: 'tap', pose: 'point', text: '最後に、曲の行ナマ。押してみるナマ。その曲が開いて、プレイヤーに移りナマ。' }
      ]
    },
    {
      id: 'player', page: 'player', title: 'プレイヤー', desc: '再生・ズーム・速度・ミキサー・マーカーの使い方', icon: 'yay', since: 3,
      steps: [
        { pose: 'wave', text: 'プレイヤーの章ナマ。曲を開いた状態だと、実際のボタンを光らせて案内できるナマ。ボタンは実際に押して試せるナマ。まだ曲を開いてない時は、先にファイル一覧から曲を選ぶナマ。' },
        { target: '.file-bar', pose: 'point', text: '上の帯に曲名と時間が出るナマ。右側の☁は、マーカーの保存がサーバーと合っているかの印ナマ。' },
        { target: '.tseek-scroll', mode: 'tap', pose: 'point', text: 'パートごとの波形ナマ。押した場所から再生できて、上の帯のマーカー名を押すと、そのマーカーの位置へ移動しナマ。試しに触ってみるナマ。' },
        { target: '.tseek-zoombar', mode: 'free', pose: 'point', bubblePos: 'bottom', text: '波形のズームはこの行ナマ。「＋」「－」で拡大・縮小できて、行の空いている所を横に引っぱると、拡大したまま表示範囲を動かせナマ。赤い線は、曲全体の中の今の位置ナマ。実際に触ってみるナマ。' },
        { target: '.play-btn', mode: 'tap', pose: 'point', text: '真ん中のボタンが再生と一時停止ナマ。押してみるナマ。' },
        { target: '.playback-controls', mode: 'tap', pose: 'point', text: '再生ボタンの両脇が、少し戻る／少し進むのボタン群ナマ。いちばん端の⏮は、前のマーカーの頭へ戻るボタン。秒数は設定で変えられナマ。押してみるナマ。' },
        { target: ['.play-btn', '.playback-rate-badge'], mode: 'free', pose: 'point', text: '再生速度は、再生ボタンを縦にスワイプ（パソコンではスクロール）すると変えられナマ。ピッチ維持がONの間は、速度を動かすと上に「速度変更を確定しますか？」と出るので、「確定する」を押して初めて変わりナマ。確定する前に元の％へ戻すと、変更は取り消しになるナマ。' },
        { target: ['.range-bar', '.section-list'], mode: 'free', pose: 'point', text: 'マーカーリストナマ。マーカーを押すと、そこから次のマーカーまでを再生しナマ。マーカーを選ぶと上に範囲バーが出て、終わりのマーカーや、同じ範囲を繰り返すループも選べるナマ。部分練習に便利ナマ。実際に押してみるナマ。' },
        { target: '.track-mixer', mode: 'free', pose: 'point', text: 'トラック音量ナマ。パートごとに音量を変えられナマ。「M」はそのパートの消音、「Solo」はそのパートだけを鳴らすボタン。「1/3」は音量を1/3にして、もう一度押すと元に戻りナマ。スライダーをダブルタップすると100％に戻って、％の数字を押すと数値で直接入れられナマ。実際に触ってみるナマ。' },
        { target: '.download-all-btn', pose: 'point', text: '「このバランスでダウンロード」は、今のミキサーのバランスのまま、曲全体を1つの音源ファイルにまとめて保存するボタン。自分のパートを大きくした練習用音源も作れるナマ。' },
        { page: 'player-settings', target: ['.mode-selector', '.settings-panel'], pose: 'point', text: '最後は設定モード（上の「設定」ボタンで切り替わりナマ）。スキップの秒数や微調整の幅、ピッチ維持のON/OFFを変えられナマ。音声キャッシュの容量や、この案内ボタンの表示・非表示もここナマ。設定はこの端末の中に保存されナマ。' }
      ]
    },
    {
      id: 'edit', page: 'player', title: 'マーカー編集', desc: 'マーカーの追加・移動・削除（全員が使えます）', icon: 'thinking', since: 2,
      steps: [
        { page: 'player', target: '.mode-selector', mode: 'tap', pose: 'point', text: '上のボタンで「再生」「編集」「設定」を切り替えるナマ。この章では編集を見ていくナマ。マーカーの編集は、管理者でなくても全員ができるナマ。「編集」を押してみるナマ。' },
        { page: 'player-edit', target: '.section-list-header', mode: 'free', pose: 'point', text: 'マーカーの追加は、ここの「＋」からナマ。今の再生位置にマーカーができナマ。ただしマーカーは団体のみんなで共有するデータで、追加するとその場で全員に反映されナマ。自分の練習用なら名前でも入れとくとわかりやすいかもナマ。' },
        { page: 'player-edit', target: '.mark-controls', pose: 'point', text: 'マーカーを選んだ状態で、合わせたい場所まで再生して「マーカーをここへ」を押すと、そのマーカーを今の位置へ動かせナマ。隣のマーカーを追い越して動かしても大丈夫ナマ。' },
        { page: 'player-edit', target: '.section-item', mode: 'tap', pose: 'point', text: '次は位置の微調整ナマ。まず、リストのマーカーの行を押して、そのマーカーの詳細を開くナマ。どれか1つの行を押してみるナマ。' },
        { page: 'player-edit', target: '.flag-editor', mode: 'free', pose: 'point', text: 'マーカーを選ぶと出る、位置の微調整パネルナマ。数字を直接入れたり、下のボタンで少しずつ動かしたりできナマ。名前の変更は、リストの名前を押すとできナマ。変更は自動で保存されナマ。' },
        { page: 'player-edit', target: '.section-list', mode: 'free', pose: 'point', text: 'マーカーの削除は、行の右側の削除ボタンからナマ。間違えて消さないよう、ボタンを2回押して初めて消える作りナマ。上の「元に戻す」ボタンで、直前の操作を取り消すこともできナマ。' }
      ]
    }
  ]
};
