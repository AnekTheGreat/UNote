package app.unote;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * The whole app is one page. It is bundled in assets/www and served from
 * https://appassets.androidplatform.net, not file://, because WebView refuses
 * IndexedDB and service workers on file:// - and the notes live in IndexedDB.
 *
 * Backups are the one thing the page cannot do by itself: a WebView has no download
 * manager and no file chooser unless the app supplies one. So the page calls into
 * window.UNoteFile, and this activity opens the phone's own save dialog and file
 * picker and carries the text across. Nothing leaves the phone.
 */
public class MainActivity extends Activity {

    private static final String HOME = "https://appassets.androidplatform.net/assets/www/index.html";
    private static final int REQ_SAVE = 41;
    private static final int REQ_PICK = 42;

    private WebView web;
    private String pendingText;
    private String pendingName;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setTextZoom(100);
        web.setBackgroundColor(0xFF0D0B14);
        web.setWebViewClient(new WebViewClientCompat() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    Uri u = request.getUrl();
                    String host = (u == null || u.getHost() == null) ? "" : u.getHost();
                    if (host.equals("appassets.androidplatform.net")) {
                        return false;                       // the page itself stays in the app
                    }
                    try {                                   // anything else belongs to the phone
                        startActivity(new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                    } catch (Exception ignored) {
                        // no browser and no store: the tap does nothing rather than breaking the page
                    }
                    return true;
                }
        });
        web.addJavascriptInterface(new Files(), "UNoteFile");

        setContentView(web);
        if (state != null) {
            web.restoreState(state);
        } else {
            web.loadUrl(HOME);
        }
    }

    /** What window.UNoteFile exposes to the page. */
    private class Files {

        @JavascriptInterface
        public boolean ready() {
            return true;
        }

        @JavascriptInterface
        public void saveBackup(final String name, final String text) {
            pendingName = name;
            pendingText = text;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType("application/json");
                    if (name != null && name.length() > 0) {
                        i.putExtra(Intent.EXTRA_TITLE, name);
                    }
                    try {
                        startActivityForResult(i, REQ_SAVE);
                    } catch (Exception e) {
                        pendingText = null;
                        tell("window.UNoteSaved && window.UNoteSaved(false)");
                    }
                }
            });
        }

        @JavascriptInterface
        public void pickBackup() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    // */* on purpose: a .json the phone labelled octet-stream must still be pickable.
                    Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType("*/*");
                    try {
                        startActivityForResult(i, REQ_PICK);
                    } catch (Exception e) {
                        tell("window.UNotePicked && window.UNotePicked(false)");
                    }
                }
            });
        }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        Uri uri = (res == RESULT_OK && data != null) ? data.getData() : null;
        if (req == REQ_SAVE) {
            final String text = pendingText;
            pendingText = null;
            if (uri == null || text == null) {
                tell("window.UNoteSaved && window.UNoteSaved(false)");
                return;
            }
            writeInBackground(uri, text);
        } else if (req == REQ_PICK) {
            if (uri == null) {
                tell("window.UNotePicked && window.UNotePicked(false)");
                return;
            }
            readInBackground(uri);
        }
    }

    private void writeInBackground(final Uri uri, final String text) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                boolean ok = false;
                try (OutputStream os = getContentResolver().openOutputStream(uri, "wt")) {
                    if (os != null) {
                        os.write(text.getBytes(StandardCharsets.UTF_8));
                        os.flush();
                        ok = true;
                    }
                } catch (Exception e) {
                    ok = false;
                }
                tell(ok ? "window.UNoteSaved && window.UNoteSaved(true)"
                        : "window.UNoteSaved && window.UNoteSaved(false)");
            }
        }).start();
    }

    private void readInBackground(final Uri uri) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                String text = null;
                try (InputStream in = getContentResolver().openInputStream(uri)) {
                    if (in != null) {
                        ByteArrayOutputStream bo = new ByteArrayOutputStream();
                        byte[] buf = new byte[8192];
                        int n;
                        while ((n = in.read(buf)) > 0) {
                            bo.write(buf, 0, n);
                        }
                        text = new String(bo.toByteArray(), StandardCharsets.UTF_8);
                    }
                } catch (Exception e) {
                    text = null;
                }
                if (text == null) {
                    tell("window.UNotePicked && window.UNotePicked(false)");
                    return;
                }
                // A whole backup is too long for one evaluateJavascript call, so it goes in pieces.
                final int chunk = 120000;
                for (int i = 0; i < text.length(); i += chunk) {
                    String piece = text.substring(i, Math.min(text.length(), i + chunk));
                    tell("window.UNotePickChunk && window.UNotePickChunk(" + jsonStr(piece) + ")");
                }
                tell("window.UNotePicked && window.UNotePicked(true)");
            }
        }).start();
    }

    private void tell(final String js) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (web != null) {
                    web.evaluateJavascript(js, null);
                }
            }
        });
    }

    private static String jsonStr(String s) {
        if (s == null) {
            return "null";
        }
        StringBuilder b = new StringBuilder(s.length() + 32);
        b.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20) {
                        b.append(String.format("\\u%04x", (int) c));
                    } else {
                        b.append(c);
                    }
            }
        }
        b.append('"');
        return b.toString();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) {
            web.saveState(out);
        }
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
