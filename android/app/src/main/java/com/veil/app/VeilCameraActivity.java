package com.veil.app;

import android.content.Intent;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ColorFilter;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.RectF;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.util.Size;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.core.Preview;
import androidx.camera.core.resolutionselector.ResolutionSelector;
import androidx.camera.core.resolutionselector.ResolutionStrategy;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.google.common.util.concurrent.ListenableFuture;
import java.io.File;

/** Local camera surface. Only pressing the shutter creates a temporary app-private JPEG. */
public class VeilCameraActivity extends AppCompatActivity {
  private static final int INK = Color.rgb(12, 22, 34);
  private static final int ACCENT = Color.rgb(61, 220, 177);
  private PreviewView previewView;
  private ProcessCameraProvider provider;
  private ImageCapture capture;
  private Camera camera;
  private ImageButton shutter;
  private ImageButton flash;
  private TextView status;
  private boolean front;
  private boolean torch;
  private boolean delivered;
  private File output;

  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView()).setAppearanceLightStatusBars(false);
    WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView()).setAppearanceLightNavigationBars(false);
    buildSurface();
    ListenableFuture<ProcessCameraProvider> future = ProcessCameraProvider.getInstance(this);
    future.addListener(() -> {
      try { provider = future.get(); bindCamera(); }
      catch (Exception error) { status.setText("Camera unavailable. Close and try again."); }
    }, ContextCompat.getMainExecutor(this));
  }

  private int dp(float value) { return Math.round(value * getResources().getDisplayMetrics().density); }

  private TextView text(String value, int size, int color) {
    TextView view = new TextView(this);
    view.setText(value); view.setTextSize(size); view.setTextColor(color);
    view.setGravity(Gravity.CENTER_VERTICAL);
    view.setFontFeatureSettings("kern");
    return view;
  }

  private ImageButton icon(String kind, String description) {
    ImageButton button = new ImageButton(this);
    button.setImageDrawable(new CameraIcon(kind));
    button.setContentDescription(description);
    button.setBackgroundColor(Color.TRANSPARENT);
    button.setPadding(dp(14), dp(14), dp(14), dp(14));
    button.setOnTouchListener((view, event) -> {
      boolean pressed = event.getActionMasked() == MotionEvent.ACTION_DOWN;
      if (pressed || event.getActionMasked() == MotionEvent.ACTION_UP ||
          event.getActionMasked() == MotionEvent.ACTION_CANCEL) {
        view.animate().scaleX(pressed ? .92f : 1f).scaleY(pressed ? .92f : 1f)
          .setDuration(pressed ? 80 : 140).start();
      }
      return false;
    });
    return button;
  }

  private void buildSurface() {
    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(INK);
    ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
      androidx.core.graphics.Insets bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
      return insets;
    });
    setContentView(root);
    LinearLayout header = new LinearLayout(this);
    header.setGravity(Gravity.CENTER_VERTICAL);
    header.setPadding(dp(12), dp(8), dp(12), dp(8));
    ImageButton close = icon("close", "Close camera");
    close.setOnClickListener(v -> finish());
    header.addView(close, new LinearLayout.LayoutParams(dp(56), dp(56)));
    TextView title = text("Veil Camera", 20, Color.WHITE);
    title.setTypeface(null, android.graphics.Typeface.BOLD);
    header.addView(title, new LinearLayout.LayoutParams(0, dp(56), 1));
    flash = icon("flash", "Turn on torch");
    flash.setOnClickListener(v -> {
      if (camera == null || !camera.getCameraInfo().hasFlashUnit()) return;
      torch = !torch; camera.getCameraControl().enableTorch(torch);
      flash.setAlpha(torch ? 1f : .65f);
      flash.setContentDescription(torch ? "Turn off torch" : "Turn on torch");
    });
    header.addView(flash, new LinearLayout.LayoutParams(dp(56), dp(56)));
    root.addView(header, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(72)));

    FrameLayout viewfinder = new FrameLayout(this);
    previewView = new PreviewView(this);
    previewView.setImplementationMode(PreviewView.ImplementationMode.COMPATIBLE);
    previewView.setScaleType(PreviewView.ScaleType.FIT_CENTER);
    previewView.getPreviewStreamState().observe(this, stream -> {
      if (stream == PreviewView.StreamState.STREAMING) android.util.Log.i("VeilCamera", "Preview streaming");
    });
    viewfinder.addView(previewView, new FrameLayout.LayoutParams(-1, -1));
    root.addView(viewfinder, new LinearLayout.LayoutParams(-1, 0, 1));

    LinearLayout footer = new LinearLayout(this);
    footer.setOrientation(LinearLayout.VERTICAL);
    footer.setPadding(dp(24), dp(20), dp(24), dp(12));
    FrameLayout controls = new FrameLayout(this);
    shutter = icon("shutter", "Capture photo");
    shutter.setPadding(0, 0, 0, 0);
    shutter.setEnabled(false); shutter.setAlpha(.5f);
    shutter.setOnClickListener(v -> capturePhoto());
    FrameLayout.LayoutParams middle = new FrameLayout.LayoutParams(dp(80), dp(80), Gravity.CENTER);
    controls.addView(shutter, middle);
    ImageButton flip = icon("flip", "Switch camera");
    GradientDrawable background = new GradientDrawable();
    background.setColor(Color.rgb(30, 43, 56)); background.setCornerRadius(dp(28));
    flip.setBackground(background);
    flip.setOnClickListener(v -> {
      if (provider == null || !shutter.isEnabled()) return;
      front = !front; torch = false; bindCamera();
    });
    FrameLayout.LayoutParams right = new FrameLayout.LayoutParams(dp(56), dp(56), Gravity.RIGHT | Gravity.CENTER_VERTICAL);
    controls.addView(flip, right);
    footer.addView(controls, new LinearLayout.LayoutParams(-1, dp(88)));
    status = text("Only you choose what gets saved", 13, Color.rgb(180, 199, 211));
    status.setGravity(Gravity.CENTER); status.setPadding(0, dp(12), 0, 0);
    footer.addView(status, new LinearLayout.LayoutParams(-1, dp(36)));
    root.addView(footer);
  }

  private void bindCamera() {
    try {
      CameraSelector selector = front ? CameraSelector.DEFAULT_FRONT_CAMERA : CameraSelector.DEFAULT_BACK_CAMERA;
      if (!provider.hasCamera(selector)) { front = !front; return; }
      provider.unbindAll();
      Preview preview = new Preview.Builder().build();
      preview.setSurfaceProvider(previewView.getSurfaceProvider());
      ResolutionSelector resolution = new ResolutionSelector.Builder().setResolutionStrategy(
        new ResolutionStrategy(new Size(4000, 3000), ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER)).build();
      capture = new ImageCapture.Builder().setResolutionSelector(resolution)
        .setJpegQuality(92).setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY).build();
      camera = provider.bindToLifecycle(this, selector, preview, capture);
      flash.setEnabled(camera.getCameraInfo().hasFlashUnit());
      flash.setAlpha(flash.isEnabled() ? .65f : .25f);
      shutter.setEnabled(true); shutter.setAlpha(1);
    } catch (Exception error) {
      status.setText("Camera unavailable. Close and try again.");
      shutter.setEnabled(false);
    }
  }

  private void capturePhoto() {
    if (capture == null) return;
    shutter.setEnabled(false); status.setText("Capturing...");
    try {
      File directory = new File(getCacheDir(), "veil-camera");
      if (!directory.exists() && !directory.mkdirs()) throw new Exception("No temporary storage.");
      output = File.createTempFile("capture-", ".jpg", directory);
      capture.takePicture(new ImageCapture.OutputFileOptions.Builder(output).build(),
        ContextCompat.getMainExecutor(this), new ImageCapture.OnImageSavedCallback() {
          @Override public void onImageSaved(@NonNull ImageCapture.OutputFileResults result) {
            if (isFinishing()) { output.delete(); return; }
            delivered = true;
            setResult(RESULT_OK, new Intent().putExtra("capturePath", output.getAbsolutePath()));
            finish();
          }
          @Override public void onError(@NonNull ImageCaptureException error) {
            if (output != null) output.delete();
            shutter.setEnabled(true); status.setText("Could not capture. Try again.");
          }
        });
    } catch (Exception error) {
      shutter.setEnabled(true); status.setText("Could not capture. Try again.");
    }
  }

  @Override protected void onDestroy() {
    if (provider != null) provider.unbindAll();
    if (!delivered && output != null) output.delete();
    super.onDestroy();
  }

  /** Consistent 28dp native controls; no font glyphs or remote icon assets. */
  private static class CameraIcon extends Drawable {
    private final String kind;
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    CameraIcon(String kind) { this.kind = kind; }
    @Override public void draw(@NonNull Canvas canvas) {
      canvas.save();
      canvas.translate(getBounds().left, getBounds().top);
      canvas.scale(getBounds().width() / 24f, getBounds().height() / 24f);
      paint.setColor(Color.WHITE); paint.setStyle(Paint.Style.STROKE);
      paint.setStrokeWidth(1.8f); paint.setStrokeCap(Paint.Cap.ROUND); paint.setStrokeJoin(Paint.Join.ROUND);
      if (kind.equals("close")) {
        canvas.drawLine(6, 6, 18, 18, paint); canvas.drawLine(18, 6, 6, 18, paint);
      } else if (kind.equals("flip")) {
        canvas.drawArc(new RectF(5, 5, 19, 19), 210, 140, false, paint);
        canvas.drawArc(new RectF(5, 5, 19, 19), 30, 140, false, paint);
        Path path = new Path(); path.moveTo(15, 4); path.lineTo(19, 7); path.lineTo(20, 3);
        path.moveTo(9, 20); path.lineTo(5, 17); path.lineTo(4, 21); canvas.drawPath(path, paint);
      } else if (kind.equals("flash")) {
        Path path = new Path(); path.moveTo(13, 2); path.lineTo(5, 14); path.lineTo(11, 14);
        path.lineTo(10, 22); path.lineTo(19, 10); path.lineTo(13, 10); path.close();
        canvas.drawPath(path, paint);
      } else {
        paint.setStrokeWidth(.8f); canvas.drawCircle(12, 12, 10.5f, paint);
        paint.setColor(ACCENT); paint.setStyle(Paint.Style.FILL); canvas.drawCircle(12, 12, 8.8f, paint);
      }
      canvas.restore();
    }
    @Override public void setAlpha(int alpha) { paint.setAlpha(alpha); }
    @Override public void setColorFilter(ColorFilter filter) { paint.setColorFilter(filter); }
    @Override public int getOpacity() { return PixelFormat.TRANSLUCENT; }
  }
}
