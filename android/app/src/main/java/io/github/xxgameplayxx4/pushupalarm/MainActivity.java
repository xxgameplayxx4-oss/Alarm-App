package io.github.xxgameplayxx4.pushupalarm;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.annotation.NonNull;
import androidx.webkit.WebViewAssetLoader;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.text.DateFormat;
import java.util.Date;
import java.util.Locale;

/** Hosts the web app from the bundled assets and gives it a small native alarm bridge. */
public class MainActivity extends Activity {
    private static final String EXTRA_ALARM = "from_alarm";
    private static final String HOST = "appassets.androidplatform.net";
    private static final String HOME = "https://" + HOST + "/app/index.html";
    private static final int REQ_CAMERA = 1, REQ_NOTIF = 2;

    private WebView web;
    private PermissionRequest pendingCamera;

    static Intent alarmIntent(Context c) {
        return new Intent(c, MainActivity.class)
                .putExtra(EXTRA_ALARM, true)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    }

    /** Best effort: Android may block this from the background, then the full-screen notification opens us. */
    static void launchForAlarm(Context c) {
        try { c.startActivity(alarmIntent(c)); } catch (RuntimeException ignored) { }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // the siren may start without a tap
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);

        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/app/", this::serveAsset)
                .build();
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                return loader.shouldInterceptRequest(req.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (HOST.equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (RuntimeException ignored) { }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> handleWebPermission(request));
            }
        });
        web.addJavascriptInterface(new Bridge(), "AndroidAlarm");

        boolean alarm = getIntent().getBooleanExtra(EXTRA_ALARM, false) || AlarmService.isRinging();
        applyAlarmWindow(alarm);
        web.loadUrl(alarm ? HOME + "?auto=1" : HOME);

        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIF);
        }
        Alarms.scheduleAll(this);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent.getBooleanExtra(EXTRA_ALARM, false) && AlarmService.isRinging()) {
            applyAlarmWindow(true);
            String url = web.getUrl();
            if (url == null || !url.contains("auto=1")) web.loadUrl(HOME + "?auto=1");
        }
    }

    private void applyAlarmWindow(boolean alarm) {
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(alarm);
            setTurnScreenOn(alarm);
        }
        if (alarm) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    @Override
    protected void onStop() {
        super.onStop();
        // Leaving the app mid-alarm brings the native alarm back at full volume.
        AlarmService.send(this, AlarmService.ACTION_LOUD);
    }

    @Override
    public void onBackPressed() {
        if (AlarmService.isRinging()) return; // no backing out of an alarm
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }

    /* ---------- bundled web files ---------- */

    private WebResourceResponse serveAsset(@NonNull String path) {
        if (path.isEmpty() || path.endsWith("/")) path += "index.html";
        try {
            InputStream in = getAssets().open("www/" + path);
            return new WebResourceResponse(mimeOf(path), null, in);
        } catch (IOException e) {
            WebResourceResponse r = new WebResourceResponse("text/plain", "utf-8", null);
            r.setStatusCodeAndReasonPhrase(404, "Not Found");
            return r;
        }
    }

    private static String mimeOf(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".wasm")) return "application/wasm";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".json") || p.endsWith(".webmanifest")) return "application/json";
        if (p.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }

    /* ---------- camera ---------- */

    private void handleWebPermission(PermissionRequest request) {
        boolean wantsCamera = false;
        for (String r : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) wantsCamera = true;
        }
        if (!wantsCamera) { request.deny(); return; }
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        } else {
            if (pendingCamera != null) pendingCamera.deny();
            pendingCamera = request;
            requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] results) {
        if (requestCode != REQ_CAMERA || pendingCamera == null) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
            pendingCamera.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        } else {
            pendingCamera.deny();
        }
        pendingCamera = null;
    }

    /* ---------- JS bridge: window.AndroidAlarm ---------- */

    private class Bridge {
        @JavascriptInterface
        public String getAlarms() {
            return Alarms.load(MainActivity.this).toString();
        }

        /** Saves and schedules the list; returns a short "next alarm" line. */
        @JavascriptInterface
        public String setAlarms(String json) {
            try {
                Alarms.save(MainActivity.this, new JSONArray(json));
            } catch (JSONException e) {
                return "Could not save alarms";
            }
            return nextAlarm();
        }

        @JavascriptInterface
        public String nextAlarm() {
            long t = Alarms.nextAny(MainActivity.this);
            if (t < 0) return "No alarm set";
            DateFormat f = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT);
            return "Next alarm: " + f.format(new Date(t));
        }

        @JavascriptInterface
        public boolean isRinging() {
            return AlarmService.isRinging();
        }

        /** The page's own siren is playing; mute the native one while the app is open. */
        @JavascriptInterface
        public void quiet() {
            AlarmService.send(MainActivity.this, AlarmService.ACTION_QUIET);
        }

        /** Missions done (or emergency stop): stop the alarm for good. */
        @JavascriptInterface
        public void stopRinging() {
            AlarmService.send(MainActivity.this, AlarmService.ACTION_STOP);
            runOnUiThread(() -> applyAlarmWindow(false));
        }

        /** {notifications, fullScreen} so the page can point at missing settings. */
        @JavascriptInterface
        public String permissions() {
            JSONObject o = new JSONObject();
            try {
                NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
                o.put("notifications", nm.areNotificationsEnabled());
                o.put("fullScreen", Build.VERSION.SDK_INT < 34 || nm.canUseFullScreenIntent());
            } catch (JSONException ignored) { }
            return o.toString();
        }

        @JavascriptInterface
        public void openSettings(String which) {
            runOnUiThread(() -> {
                Intent i;
                if ("fullScreen".equals(which) && Build.VERSION.SDK_INT >= 34) {
                    i = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
                            Uri.parse("package:" + getPackageName()));
                } else {
                    i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                            .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
                }
                try { startActivity(i); } catch (RuntimeException ignored) { }
            });
        }

        /** Rings in ~10 s so you can try the whole flow (lock the phone to see the lock-screen alarm). */
        @JavascriptInterface
        public void testAlarm() {
            Alarms.scheduleTest(MainActivity.this, 10_000);
        }
    }
}
