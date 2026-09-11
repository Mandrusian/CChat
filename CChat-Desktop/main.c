#include "raylib.h"
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

typedef struct {
    Color bg;
    Color rail;
    Color panel;
    Color stage;
    Color text_dark;
    Color text_light;
    Color accent;
    Color border;
    Color msg_in;
    Color msg_out;
} Theme;

Theme dark_theme = {
    (Color){11, 15, 23, 255},   // bg (#0B0F17)
    (Color){15, 23, 42, 255},   // rail (#0F172A)
    (Color){17, 24, 39, 255},   // panel (#111827)
    (Color){11, 15, 23, 255},   // stage
    (Color){248, 250, 252, 255},// text_dark
    (Color){148, 163, 184, 255},// text_light
    (Color){37, 99, 235, 255},  // accent (#2563EB)
    (Color){30, 41, 59, 255},   // border (#1E293B)
    (Color){31, 41, 55, 255},   // msg_in (#1F2937)
    (Color){37, 99, 235, 255}   // msg_out (#2563EB)
};

int main() {
    SetConfigFlags(FLAG_WINDOW_HIGHDPI | FLAG_MSAA_4X_HINT | FLAG_WINDOW_RESIZABLE);
    InitWindow(1280, 800, "CChat Desktop");
    SetWindowMinSize(900, 600);
    SetTargetFPS(60);

    char msg_input[256] = "";
    int input_cursor = 0;

    while (!WindowShouldClose()) {
        float sw = GetScreenWidth();
        float sh = GetScreenHeight();
        Theme t = dark_theme;

        // Key Input handling
        int key = GetCharPressed();
        while (key > 0) {
            if ((key >= 32) && (key <= 125) && strlen(msg_input) < 250) {
                int len = strlen(msg_input);
                msg_input[len] = (char)key;
                msg_input[len + 1] = '\0';
            }
            key = GetCharPressed();
        }
        if (IsKeyPressed(KEY_BACKSPACE) && strlen(msg_input) > 0) {
            msg_input[strlen(msg_input) - 1] = '\0';
        }

        BeginDrawing();
        ClearBackground(t.bg);

        // Column 1: Rail Navigation (Width: 68)
        Rectangle rail_rect = {0, 0, 68, sh};
        DrawRectangleRec(rail_rect, t.rail);
        DrawRectangle(67, 0, 1, sh, t.border);

        // Rail Icons
        DrawCircle(34, 40, 20, t.accent);
        DrawText("C", 27, 28, 22, t.text_dark);

        DrawCircle(34, 100, 18, t.border);
        DrawText("D", 28, 90, 18, t.text_light);

        DrawCircle(34, 150, 18, t.border);
        DrawText("F", 28, 140, 18, t.text_light);

        // Column 2: Secondary Navigation Panel (Width: 280)
        Rectangle panel_rect = {68, 0, 280, sh};
        DrawRectangleRec(panel_rect, t.panel);
        DrawRectangle(347, 0, 1, sh, t.border);

        DrawText("Messages", 84, 20, 20, t.text_dark);

        // Search Bar Box
        Rectangle search_box = {84, 55, 248, 36};
        DrawRectangleRounded(search_box, 0.2, 8, t.bg);
        DrawRectangleLinesEx(search_box, 1, t.border);
        DrawText("Search...", 96, 65, 14, t.text_light);

        // Chat Item (Alex)
        Rectangle chat_item = {76, 105, 264, 60};
        DrawRectangleRounded(chat_item, 0.15, 8, t.border);
        DrawCircle(110, 135, 18, t.accent);
        DrawText("A", 104, 125, 18, t.text_dark);
        DrawCircle(124, 149, 5, (Color){34, 197, 94, 255}); // Online status
        DrawText("Alex", 138, 118, 15, t.text_dark);
        DrawText("Hey, ready for class?", 138, 138, 12, t.text_light);

        // Column 3: Active Stage Layout
        float stage_x = 348;
        float stage_w = sw - stage_x - 280;
        if (stage_w < 300) stage_w = sw - stage_x; // Responsive wrap

        // Stage Header
        Rectangle header_rect = {stage_x, 0, stage_w, 64};
        DrawRectangleRec(header_rect, t.rail);
        DrawRectangle(stage_x, 63, stage_w, 1, t.border);

        DrawCircle(stage_x + 30, 32, 16, t.accent);
        DrawText("A", stage_x + 24, 23, 16, t.text_dark);
        DrawText("Alex", stage_x + 56, 16, 16, t.text_dark);
        DrawText("Online", stage_x + 56, 36, 12, (Color){34, 197, 94, 255});

        // Chat Messages Area
        Rectangle msg1 = {stage_x + 20, 90, 220, 40};
        DrawRectangleRounded(msg1, 0.3, 8, t.msg_in);
        DrawText("Hey, ready for class?", stage_x + 35, 102, 14, t.text_dark);

        Rectangle msg2 = {stage_x + stage_w - 220, 145, 200, 40};
        DrawRectangleRounded(msg2, 0.3, 8, t.msg_out);
        DrawText("Yeah, almost there!", stage_x + stage_w - 205, 157, 14, t.text_dark);

        // Message Composer
        Rectangle composer_rect = {stage_x, sh - 70, stage_w, 70};
        DrawRectangleRec(composer_rect, t.rail);
        DrawRectangle(stage_x, sh - 70, stage_w, 1, t.border);

        Rectangle input_box = {stage_x + 20, sh - 52, stage_w - 90, 38};
        DrawRectangleRounded(input_box, 0.3, 8, t.bg);
        DrawRectangleLinesEx(input_box, 1, t.border);

        if (strlen(msg_input) == 0) {
            DrawText("Write a message...", input_box.x + 15, input_box.y + 11, 14, t.text_light);
        } else {
            DrawText(msg_input, input_box.x + 15, input_box.y + 11, 14, t.text_dark);
        }

        // Send Button
        Rectangle send_btn = {stage_x + stage_w - 60, sh - 52, 40, 38};
        DrawRectangleRounded(send_btn, 0.3, 8, t.accent);
        DrawText("->", send_btn.x + 12, send_btn.y + 11, 14, t.text_dark);

        // Column 4: Right Details Panel (Width: 280)
        if (sw - stage_x - stage_w >= 280) {
            float details_x = sw - 280;
            Rectangle details_rect = {details_x, 0, 280, sh};
            DrawRectangleRec(details_rect, t.panel);
            DrawRectangle(details_x, 0, 1, sh, t.border);

            DrawCircle(details_x + 140, 90, 40, t.accent);
            DrawText("A", details_x + 128, 68, 38, t.text_dark);
            DrawText("Alex", details_x + 140 - MeasureText("Alex", 18)/2, 145, 18, t.text_dark);
            DrawText("Available", details_x + 140 - MeasureText("Available", 13)/2, 170, 13, t.text_light);
        }

        EndDrawing();
    }
    CloseWindow();
    return 0;
}
