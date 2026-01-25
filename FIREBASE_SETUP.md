# Firebase Setup Guide for Maltinome

Maltinomeのプリセット保存機能を有効にするためのFirebase設定手順です。

## ステップ 1: Firebaseプロジェクトの作成
1. [Firebase Console](https://console.firebase.google.com/) にアクセスします。
2. 「プロジェクトを追加」をクリックします。
3. プロジェクト名を入力（例: `maltinome-db`）し、手順に従ってプロジェクトを作成します（Googleアナリティクスはオフで構いません）。

## ステップ 2: Webアプリの追加とAPIキーの取得
1. プロジェクトの概要ページで、iOS/Androidアイコンの横にある **Webアイコン (`</>`)** をクリックします。
2. アプリのニックネームを入力（例: `Maltinome Web`）し、「登録」をクリックします（Firebase Hostingはチェック不要です）。
3. **「SDK の追加と構成」** という画面に、`const firebaseConfig = { ... };` というコードが表示されます。
4. この `firebaseConfig` の中身（apiKey, authDomain, ...）をコピーします。

## ステップ 3: コードへの適用
1. Maltinomeの **`script.js`** を開きます。
2. 860行目付近にある `firebaseConfig` 変数を見つけます。
3. 手順2でコピーした内容で上書きします。

```javascript
// 例:
const firebaseConfig = {
  apiKey: "AIzaSyD...",
  authDomain: "maltinome-db.firebaseapp.com",
  projectId: "maltinome-db",
  storageBucket: "maltinome-db.appspot.com",
  messagingSenderId: "123456...",
  appId: "1:123456..."
};
```

## ステップ 4: Cloud Firestoreの作成
1. Firebase Consoleの左メニューから **「構築」 > 「Firestore Database」** を選択します。
2. **「データベースの作成」** をクリックします。
3. データの保存場所（ロケーション）を選択します（日本なら `asia-northeast1` (Tokyo) が推奨ですが、デフォルトの `us-central1` でも動作します）。
4. **「テストモードで開始する」** を選択して「作成」をクリックします。
   * **注意**: テストモードは30日間、誰でも読み書きが可能になります。開発用としては簡単ですが、公開する場合はルールを変更する必要があります。

## ステップ 5: 動作確認
1. Maltinomeをブラウザでリロードします。
2. プリセット保存を試します。
   * 成功すると、Firestoreのコンソールに `appData` > `presets` というドキュメントが作成され、データが保存されます。
