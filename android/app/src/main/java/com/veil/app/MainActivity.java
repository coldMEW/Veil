package com.veil.app;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(VeilIntakePlugin.class);
        super.onCreate(savedInstanceState);
        applySystemBars();
    }
    private void applySystemBars() {
        int warm = android.graphics.Color.parseColor("#f5f1eb");
        getWindow().setStatusBarColor(warm);
        getWindow().setNavigationBarColor(warm);
        getWindow().getDecorView().setBackgroundColor(warm);
        androidx.core.view.WindowInsetsControllerCompat bars =
            androidx.core.view.WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setAppearanceLightStatusBars(true);
        bars.setAppearanceLightNavigationBars(true);
    }
    @Override public void onResume() {
        super.onResume();
        applySystemBars();
    }
    @Override public void onNewIntent(Intent intent) {
        setIntent(intent);
        super.onNewIntent(intent);
    }
}
