package app.unote;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.Manifest;
import android.content.pm.PackageManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * The whole app is one page. It is bundled in assets/www and served from
 * https://appassets.androidplatform.net, not file://, because WebView refuses
 * IndexedDB and service workers on file:// - and the notes live in IndexedDB.
 *
 * Two things a WebView cannot do on its own live here. Backups: the page calls into
 * window.UNoteFile and this activity opens the phone's own save dialog and file
 * picker. Updates: the page fetches the newest copy of itself from the app's site and
 * leaves it in the app's private storage, and this activity serves that copy in place
 * of the bundled one. Nothing leaves the phone except those requests.
 */
public class MainActivity extends Activity {

    private static final String HOME = "https://appassets.androidplatform.net/assets/www/index.html";
    private static final String PAGE_PATH = "/assets/www/index.html";
    private static final int REQ_SAVE = 41;
    private static final int REQ_PICK = 42;

    private WebView web;
    private String pendingText;
    private String pendingName;
    private File otaFile;
    private String builtIn;    // version of the page inside this APK, read once
    private static final int REQ_FILES = 43;
    private static final int REQ_MIC = 44;

    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest micRequest;
    private Insets lastBars;
    // The phone's own margins, in CSS pixels, handed to the page (see tellPageInsets).
    private int insetTop, insetBottom, insetLeft, insetRight;


    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        otaFile = new File(new File(getFilesDir(), "ota"), "index.html");

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);    // the picker hands files back as content://
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setTextZoom(100);
        web.setBackgroundColor(0xFF0D0B14);
        web.setWebViewClient(new WebViewClientCompat() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String p = request.getUrl().getPath();
                if (p != null && p.endsWith(PAGE_PATH)) {
                    WebResourceResponse fetched = fetchedPage();
                    if (fetched != null) {
                        return fetched;             // the copy an update left behind
                    }
                }
                return loader.shouldInterceptRequest(request.getUrl());
            }
                @Override
                public void onPageFinished(WebView view, String url) {
                    // The page may load after the insets have already arrived: tell it again, so the
                    // CSS safe-area values are never doubled on top of the padding.
                    if (lastBars != null) {
                        tellPageInsets();
                    }
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

        /* A WebView will not open a file picker by itself: without onShowFileChooser, the page's
           "photo or video" button does nothing at all. The microphone is refused for the same
           reason, so a voice memo could never start. Both are answered here. */
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) {
                    fileCallback.onReceiveValue(null);
                }
                fileCallback = cb;
                Intent i = null;
                try {
                    i = params.createIntent();
                } catch (Exception ignored) {
                    i = null;
                }
                if (i == null) {
                    i = new Intent(Intent.ACTION_GET_CONTENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType("*/*");
                }
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(i, REQ_FILES);
                } catch (Exception e) {
                    fileCallback = null;
                    cb.onReceiveValue(null);
                    return false;
                }
                return true;
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        boolean wantsMic = false;
                        for (String r : request.getResources()) {
                            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) {
                                wantsMic = true;
                            }
                        }
                        if (!wantsMic) {
                            request.deny();
                            return;
                        }
                        if (hasMic()) {
                            request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                            return;
                        }
                        micRequest = request;
                        try {
                            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
                        } catch (Exception e) {
                            micRequest = null;
                            request.deny();
                        }
                    }
                });
            }
        });


        setContentView(web);

        /* Android 15 and later draw the app behind the status bar, the notch and the row of
           navigation buttons. A WebView reports no CSS env(safe-area-inset-*) values of its own,
           and padding the WebView does not move the page's fixed bars - which is why the first
           line of the screen ended up under the clock. So the heights of those bars are handed
           to the page as CSS variables, the same numbers a browser would give it, and the page
           lays itself out with them. They are sent again whenever they change - a rotation, a
           cutout, the keyboard - and again when the page has finished loading. */
        /* Only from Android 15 is the window really drawn behind those bars. Below that the phone
           lays the app out between them already, and the insets describe bars the page is not
           under, so applying them there would leave a second empty strip. */
        if (Build.VERSION.SDK_INT >= 35) {
            ViewCompat.setOnApplyWindowInsetsListener(web, (v, insets) -> {
                lastBars = insets.getInsets(WindowInsetsCompat.Type.systemBars()
                        | WindowInsetsCompat.Type.displayCutout()
                        | WindowInsetsCompat.Type.ime());
                tellPageInsets();
                return insets;
            });
            ViewCompat.requestApplyInsets(web);
        }
        if (state != null) {
            web.restoreState(state);
        } else {
            web.loadUrl(HOME);
        }
    }

    /** The phone's margins, as CSS pixels, pushed into the page. CSS pixels and dp are the same
     *  length inside this WebView (textZoom is pinned at 100 and the page asks for no scaling), so
     *  the physical insets are divided by the screen density once, here. */
    private void tellPageInsets() {
        if (web == null || lastBars == null) {
            return;
        }
        float density = getResources().getDisplayMetrics().density;
        if (density <= 0f) {
            density = 1f;
        }
        insetTop = Math.round(lastBars.top / density);
        insetBottom = Math.round(lastBars.bottom / density);
        insetLeft = Math.round(lastBars.left / density);
        insetRight = Math.round(lastBars.right / density);
        web.evaluateJavascript(
                "(function(){var d=document.documentElement;if(!d)return;"
                + "d.style.setProperty('--safe-t','" + insetTop + "px');"
                + "d.style.setProperty('--safe-b','" + insetBottom + "px');"
                + "d.style.setProperty('--safe-l','" + insetLeft + "px');"
                + "d.style.setProperty('--safe-r','" + insetRight + "px');})()", null);
    }

    /** The fetched page, if there is one that still looks like UNote - and only if it is newer than
     *  the page inside this APK. Installing a newer app used to leave an older fetched page in
     *  charge, which made the new APK look like it had changed nothing at all. */
    private WebResourceResponse fetchedPage() {
        if (otaFile == null || !otaFile.isFile()) {
            return null;
        }
        try {
            byte[] bytes = readFile(otaFile);
            String head = new String(bytes, StandardCharsets.UTF_8);
            if (bytes.length < 20000 || !head.contains("const VERSION = '")) {
                return null;                    // a half-written file must never take the app down
            }
            String fetched = pageVersion(head);
            String bundled = builtInVersion();
            boolean stale = fetched.isEmpty()
                    || (!bundled.isEmpty() && compareVersions(fetched, bundled) < 0);
            if (stale) {
                // The app on this phone is newer than the page an earlier update left behind:
                // the copy that came inside the APK wins, and the stale one is dropped.
                otaFile.delete();
                return null;
            }
            return new WebResourceResponse("text/html", "utf-8", new ByteArrayInputStream(bytes));
        } catch (Exception e) {
            return null;
        }
    }

    /** What window.UNoteFile exposes to the page. */
    private class Files {

        @JavascriptInterface
        public boolean ready() {
            return true;
        }

        @JavascriptInterface
        public boolean hasPage() {
            return otaFile != null && otaFile.isFile();
        }

        /** The same values as the CSS variables, for a page that has just started and would
         *  otherwise draw one frame under the status bar. */
        @JavascriptInterface
        public int safeTop() {
            return insetTop;
        }

        @JavascriptInterface
        public int safeBottom() {
            return insetBottom;
        }

        @JavascriptInterface
        public int safeLeft() {
            return insetLeft;
        }

        @JavascriptInterface
        public int safeRight() {
            return insetRight;
        }

        @JavascriptInterface
        public String pageSource() {
            if (otaFile == null || !otaFile.isFile()) {
                return "built-in " + builtInVersion();
            }
            try {
                String v = pageVersion(new String(readFile(otaFile), StandardCharsets.UTF_8));
                return "fetched " + (v.isEmpty() ? "unknown" : v);
            } catch (Exception e) {
                return "built-in " + builtInVersion();
            }
        }

        @JavascriptInterface
        public void savePage(final String html) {
            if (html == null || html.length() < 20000 || !html.contains("const VERSION = '")) {
                tell("window.UNoteSaved && window.UNoteSaved(false)");
                return;
            }
            new Thread(new Runnable() {
                @Override
                public void run() {
                    boolean ok = false;
                    File dir = otaFile.getParentFile();
                    File tmp = new File(dir, "index.html.tmp");
                    try {
                        if (dir != null && !dir.isDirectory()) {
                            dir.mkdirs();
                        }
                        FileOutputStream out = new FileOutputStream(tmp);
                        out.write(html.getBytes(StandardCharsets.UTF_8));
                        out.flush();
                        out.close();
                        ok = tmp.renameTo(otaFile) || (otaFile.delete() && tmp.renameTo(otaFile));
                    } catch (Exception e) {
                        ok = false;
                    }
                    tell(ok ? "window.UNoteSaved && window.UNoteSaved(true)"
                            : "window.UNoteSaved && window.UNoteSaved(false)");
                }
            }).start();
        }

        @JavascriptInterface
        public void resetPage() {
            try {
                if (otaFile != null && otaFile.exists()) {
                    otaFile.delete();
                }
                File tmp = new File(otaFile.getParentFile(), "index.html.tmp");
                if (tmp.exists()) {
                    tmp.delete();
                }
            } catch (Exception ignored) {
                // nothing to remove
            }
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
        } else if (req == REQ_FILES) {
            ValueCallback<Uri[]> cb = fileCallback;
            fileCallback = null;
            if (cb != null) {
                cb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
            }
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

    /** The version of the page that came inside this APK, read once. */
    private String builtInVersion() {
        if (builtIn != null) {
            return builtIn;
        }
        builtIn = "";
        try (InputStream in = getAssets().open("www/index.html")) {
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) {
                bo.write(buf, 0, n);
            }
            builtIn = pageVersion(new String(bo.toByteArray(), StandardCharsets.UTF_8));
        } catch (Exception e) {
            builtIn = "";
        }
        return builtIn;
    }

    /** "1.0.14" out of the page's own `const VERSION = '...'` line. */
    private static String pageVersion(String html) {
        if (html == null) {
            return "";
        }
        String marker = "const VERSION = '";
        int at = html.indexOf(marker);
        if (at < 0) {
            return "";
        }
        int from = at + marker.length();
        int to = html.indexOf('\'', from);
        if (to < 0 || to - from > 20) {
            return "";
        }
        return html.substring(from, to).trim();
    }

    private static int compareVersions(String a, String b) {
        String[] x = a.split("\\.");
        String[] y = b.split("\\.");
        int n = Math.max(x.length, y.length);
        for (int i = 0; i < n; i++) {
            int xi = i < x.length ? versionPart(x[i]) : 0;
            int yi = i < y.length ? versionPart(y[i]) : 0;
            if (xi != yi) {
                return xi < yi ? -1 : 1;
            }
        }
        return 0;
    }

    private static int versionPart(String s) {
        try {
            return Integer.parseInt(s.trim());
        } catch (Exception e) {
            return 0;
        }
    }

    private boolean hasMic() {
        try {
            return checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        } catch (Exception e) {
            return false;
        }
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] granted) {
        super.onRequestPermissionsResult(req, perms, granted);
        if (req != REQ_MIC) {
            return;
        }
        boolean ok = granted.length > 0 && granted[0] == PackageManager.PERMISSION_GRANTED;
        PermissionRequest waiting = micRequest;
        micRequest = null;
        if (waiting == null) {
            return;
        }
        if (ok) {
            waiting.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        } else {
            waiting.deny();
        }
    }

    @Override
    protected void onDestroy() {
        if (fileCallback != null) {
            fileCallback.onReceiveValue(null);
            fileCallback = null;
        }
        super.onDestroy();
    }

    private static byte[] readFile(File f) throws Exception {
        FileInputStream in = new FileInputStream(f);
        try {
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) {
                bo.write(buf, 0, n);
            }
            return bo.toByteArray();
        } finally {
            in.close();
        }
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
