using System;
using System.Drawing;
using System.Drawing.Drawing2D;

internal static class LauncherArtwork
{
    public const int Width = 820;
    public const int Height = 460;
    public const float IntroDuration = 3.4f;

    static readonly Color Night = Color.FromArgb(11, 10, 16);
    static readonly Color Coral = Color.FromArgb(255, 112, 70);
    static readonly Color Peach = Color.FromArgb(255, 191, 143);
    static readonly Color Violet = Color.FromArgb(146, 105, 221);
    static readonly Color Ivory = Color.FromArgb(255, 243, 233);

    public static GraphicsPath Rounded(RectangleF bounds, float radius)
    {
        float d = radius * 2;
        var path = new GraphicsPath();
        path.AddArc(bounds.Left, bounds.Top, d, d, 180, 90);
        path.AddArc(bounds.Right - d, bounds.Top, d, d, 270, 90);
        path.AddArc(bounds.Right - d, bounds.Bottom - d, d, d, 0, 90);
        path.AddArc(bounds.Left, bounds.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    static float Progress(float value, float start, float end)
    {
        return Math.Max(0f, Math.Min(1f, (value - start) / (end - start)));
    }

    static float Ease(float progress)
    {
        float left = 1 - progress;
        return 1 - left * left * left * left;
    }

    static Color Alpha(Color color, float opacity)
    {
        return Color.FromArgb((int)(255 * Math.Max(0, Math.Min(1, opacity))), color);
    }

    static void Glow(Graphics graphics, RectangleF bounds, Color color, float opacity)
    {
        using (var shape = new GraphicsPath())
        {
            shape.AddEllipse(bounds);
            using (var fill = new PathGradientBrush(shape))
            {
                fill.CenterColor = Alpha(color, opacity);
                fill.SurroundColors = new[] { Alpha(color, 0) };
                graphics.FillPath(fill, shape);
            }
        }
    }

    static void LightTrail(Graphics graphics, float x, float y, float length, float width, int direction, Color color, float opacity)
    {
        GraphicsState state = graphics.Save();
        graphics.TranslateTransform(x, y);
        graphics.RotateTransform(-13f);
        graphics.ScaleTransform(direction, 1f);
        var bounds = new RectangleF(-length, -width / 2, length, width);
        using (var brush = new LinearGradientBrush(bounds, Alpha(color, 0), Alpha(color, opacity), 0f))
        {
            graphics.FillPolygon(brush, new[] {
                new PointF(-length, 0), new PointF(-width, -width / 2),
                new PointF(0, -width / 2), new PointF(0, width / 2), new PointF(-width, width / 2),
            });
        }
        graphics.Restore(state);
    }

    static void DrawMark(Graphics graphics, float x, float y, float size, float time, float opacity)
    {
        GraphicsState state = graphics.Save();
        graphics.TranslateTransform(x, y);
        graphics.ScaleTransform(size / 128f, size / 128f);

        float body = Ease(Progress(time, .49f, 1.31f));
        float clapper = Ease(Progress(time, .33f, 1.25f));
        float play = Ease(Progress(time, .72f, 1.48f));

        GraphicsState lower = graphics.Save();
        graphics.TranslateTransform((1 - body) * 350, (1 - body) * -67);
        var caseRect = new RectangleF(-55, -17, 110, 66);
        using (var path = Rounded(caseRect, 15))
        using (var fill = new LinearGradientBrush(caseRect, Alpha(Color.FromArgb(53, 28, 44), opacity * body), Alpha(Night, opacity * body), 90f))
        using (var border = new Pen(Alpha(Coral, opacity * body), 3f))
        {
            graphics.FillPath(fill, path);
            graphics.DrawPath(border, path);
        }
        graphics.Restore(lower);

        GraphicsState upper = graphics.Save();
        graphics.TranslateTransform((1 - clapper) * -390, (1 - clapper) * 90);
        graphics.RotateTransform(-12 - 17 * (1 - clapper));
        var clapperRect = new RectangleF(-56, -47, 112, 24);
        using (var path = Rounded(clapperRect, 7))
        using (var fill = new LinearGradientBrush(clapperRect, Alpha(Peach, clapper * opacity), Alpha(Coral, clapper * opacity), 90f))
        {
            graphics.FillPath(fill, path);
            graphics.SetClip(path, CombineMode.Intersect);
            using (var stripe = new SolidBrush(Alpha(Color.FromArgb(112, 38, 49), clapper * opacity * .68f)))
            {
                for (int i = -45; i < 60; i += 29)
                    graphics.FillPolygon(stripe, new[] { new Point(i, -47), new Point(i + 10, -47), new Point(i + 28, -23), new Point(i + 18, -23) });
            }
        }
        graphics.Restore(upper);

        GraphicsState triangle = graphics.Save();
        graphics.TranslateTransform(0, (1 - play) * 45);
        using (var fill = new SolidBrush(Alpha(Ivory, play * opacity)))
            graphics.FillPolygon(fill, new[] { new PointF(-11, 1), new PointF(16, 17), new PointF(-11, 33) });
        graphics.Restore(triangle);
        graphics.Restore(state);
    }

    static void Wordmark(Graphics graphics, string text, float x, float y, float size, Color top, Color bottom, float reveal, bool centered, float opacity = 1)
    {
        if (reveal <= 0 || opacity <= 0) return;
        using (var path = new GraphicsPath())
        {
            path.AddString(text, FontFamily.GenericSansSerif, (int)FontStyle.Bold, size, new PointF(0, 0), StringFormat.GenericTypographic);
            RectangleF natural = path.GetBounds();
            using (var offset = new Matrix())
            {
                offset.Translate(x - natural.X - (centered ? natural.Width / 2 : 0), y - natural.Y);
                path.Transform(offset);
            }
            RectangleF bounds = path.GetBounds();
            GraphicsState state = graphics.Save();
            if (reveal < 1)
                graphics.SetClip(new RectangleF(bounds.Left - 2, bounds.Top - 2, (bounds.Width + 4) * reveal, bounds.Height + 4), CombineMode.Intersect);
            using (var brush = new LinearGradientBrush(bounds, Alpha(top, opacity), Alpha(bottom, opacity), 90f))
                graphics.FillPath(brush, path);
            graphics.Restore(state);
        }
    }

    public static void DrawIntro(Graphics graphics, float seconds)
    {
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        graphics.Clear(Night);
        float glow = Ease(Progress(seconds, .13f, 1.08f));
        float fade = Progress(seconds, 2.91f, IntroDuration);
        Glow(graphics, new RectangleF(81, -65, 658, 591), Color.FromArgb(119, 40, 65), glow * .64f);
        Glow(graphics, new RectangleF(229, 36, 387, 348), Color.FromArgb(118, 44, 116), glow * .19f);

        for (int i = 0; i < 23; i++)
        {
            int direction = i % 3 == 0 ? -1 : 1;
            float start = .012f + (i % 11) * .052f;
            float p = Progress(seconds, start, start + .76f + (i % 4) * .06f);
            if (p <= 0 || p >= 1) continue;
            float velocity = p * p * (3 - 2 * p);
            float x = direction == 1 ? -240 + velocity * 1260 : 1070 - velocity * 1330;
            float y = 62 + (i * 67 % 345) + direction * (1 - velocity) * 48;
            float strength = (float)Math.Pow(Math.Sin(p * Math.PI), 1.3) * (i % 5 == 0 ? .74f : .45f);
            Color color = i % 7 == 0 ? Violet : i % 3 == 0 ? Peach : Coral;
            LightTrail(graphics, x, y, 85 + i % 8 * 30, i % 5 == 0 ? 19 : 2 + i % 5, direction, color, strength);
        }

        float arrival = Progress(seconds, .78f, 1.47f);
        if (arrival > 0 && arrival < 1)
            Glow(graphics, new RectangleF(322, 76, 176, 174), Coral, (float)Math.Sin(arrival * Math.PI) * .36f);
        DrawMark(graphics, 410, 168, 154, seconds, 1);

        float reveal = Ease(Progress(seconds, 1.03f, 2.03f));
        float rise = 1 - Ease(Progress(seconds, 1.14f, 2.20f));
        Wordmark(graphics, "Shopee Clip", 410, 252 + rise * 18, 76, Ivory, Peach, reveal, true);

        float pass = Progress(seconds, 1.38f, 2.36f);
        if (pass > 0 && pass < 1)
            LightTrail(graphics, 170 + 495 * pass, 326, 140, 2.2f, 1, Peach, (float)Math.Sin(pass * Math.PI) * .86f);
        if (fade > 0)
        {
            using (var curtain = new SolidBrush(Alpha(Night, fade * fade)))
                graphics.FillRectangle(curtain, 0, 0, Width, Height);
        }
    }

    public static void DrawDashboard(Graphics graphics, bool online, bool stopping)
    {
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        graphics.Clear(Night);
        Glow(graphics, new RectangleF(334, -184, 679, 753), Color.FromArgb(96, 34, 60), .82f);
        Glow(graphics, new RectangleF(513, 37, 311, 359), Color.FromArgb(106, 44, 112), .31f);
        using (var seam = new Pen(Color.FromArgb(45, 35, 46)))
        {
            graphics.DrawLine(seam, 36, 62, 784, 62);
            graphics.DrawLine(seam, 36, 406, 784, 406);
        }
        using (var track = new Pen(Alpha(Coral, .19f), 1f))
        {
            for (int i = 0; i < 7; i++) graphics.DrawLine(track, 431 + i * 21, 406, 603 + i * 21, 63);
        }
        LightTrail(graphics, 801, 119, 251, 2, 1, Peach, .62f);
        LightTrail(graphics, 820, 327, 278, 2, 1, Violet, .43f);
        LightTrail(graphics, 752, 373, 276, 5, 1, Coral, .35f);
        Glow(graphics, new RectangleF(517, 88, 257, 270), Coral, .19f);
        DrawMark(graphics, 633, 220, 226, 2, online && !stopping ? 1f : .77f);

        Wordmark(graphics, "Shopee", 44, 102, 68, Ivory, Color.FromArgb(242, 225, 222), 1, false);
        Wordmark(graphics, "Clip", 45, 175, 72, Peach, Coral, 1, false);

        Color indicator = stopping ? Peach : online ? Coral : Color.FromArgb(151, 140, 159);
        Glow(graphics, new RectangleF(41, 268, 23, 23), indicator, .38f);
        using (var dot = new SolidBrush(indicator)) graphics.FillEllipse(dot, 48, 275, 8, 8);
    }
}
