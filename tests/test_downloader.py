"""
Tests for the pure and filesystem-only parts of clip_downloader.py.

Out of scope, deliberately: download_full_video, cut_clip, resolve_tools,
find_ffmpeg, find_ytdlp and main() all shell out to yt-dlp/ffmpeg, touch the
network, or probe the local environment — none of that is exercised here.

Run with: python3 -m unittest discover tests
"""
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import clip_downloader


def _library():
    """A small, synthetic export shaped like a real angl-clips.json."""
    teams = [
        {"id": "t1", "name": "U16 Girls"},
        {"id": "t2", "name": "U14 Boys"},
    ]
    games = [
        {"id": "g1", "title": "Round 1 vs Eagles", "teamId": "t1"},
        {"id": "g2", "title": "Round 2 vs Hawks", "teamId": "t1"},
        {"id": "g3", "title": "Round 1 vs Sharks", "teamId": "t2"},
    ]
    playlists = [
        {"id": "p1", "name": "Offence", "gameId": "g1"},
        {"id": "p2", "name": "Defence", "gameId": "g1"},
        {"id": "p3", "name": "Offence", "gameId": "g2"},
        {"id": "p4", "name": "Offence", "gameId": "g3"},
    ]
    clips = [
        {"gameId": "g1", "playlistId": "p1", "videoId": "vid1", "label": "Clip A"},
        {"gameId": "g1", "playlistId": "p2", "videoId": "vid1", "label": "Clip B"},
        {"gameId": "g2", "playlistId": "p3", "videoId": "vid2", "label": "Clip C"},
        {"gameId": "g3", "playlistId": "p4", "videoId": "vid3", "label": "Clip D"},
    ]
    return teams, games, playlists, clips


class LoadJsonTests(unittest.TestCase):
    def test_well_formed_export_loads(self):
        data = {
            "teams": [{"id": "t1", "name": "Fixture Team"}],
            "games": [{"id": "g1", "title": "Fixture Game", "teamId": "t1"}],
            "playlists": [{"id": "p1", "name": "Offence", "gameId": "g1"}],
            "clips": [{"gameId": "g1", "playlistId": "p1", "videoId": "abc123", "label": "Clip"}],
        }
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "export.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f)
            teams, games, playlists, clips = clip_downloader.load_json(path)
        self.assertEqual(teams, data["teams"])
        self.assertEqual(games, data["games"])
        self.assertEqual(playlists, data["playlists"])
        self.assertEqual(clips, data["clips"])

    def test_missing_file_exits_1_with_a_clear_message(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "does-not-exist.json")
            buf = io.StringIO()
            with redirect_stdout(buf):
                with self.assertRaises(SystemExit) as cm:
                    clip_downloader.load_json(path)
        self.assertEqual(cm.exception.code, 1)
        out = buf.getvalue()
        self.assertIn("File not found:", out)
        self.assertIn(path, out)

    def test_malformed_json_exits_1_with_a_clear_message(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "bad.json")
            with open(path, "w", encoding="utf-8") as f:
                f.write("{not valid json")
            buf = io.StringIO()
            with redirect_stdout(buf):
                with self.assertRaises(SystemExit) as cm:
                    clip_downloader.load_json(path)
        self.assertEqual(cm.exception.code, 1)
        self.assertIn("is not a valid Angl export", buf.getvalue())

    def test_directory_path_exits_1_with_a_clear_message(self):
        # Passing a directory instead of a file raises IsADirectoryError,
        # which is an OSError but NOT a FileNotFoundError subclass, so it
        # should be caught by the generic OSError branch.
        self.assertFalse(issubclass(IsADirectoryError, FileNotFoundError))
        with tempfile.TemporaryDirectory() as tmp:
            buf = io.StringIO()
            with redirect_stdout(buf):
                with self.assertRaises(SystemExit) as cm:
                    clip_downloader.load_json(tmp)
        self.assertEqual(cm.exception.code, 1)
        self.assertIn("Could not read", buf.getvalue())

    def test_missing_top_level_keys_default_to_empty_lists(self):
        # load_json does no shape validation: a key absent from the export
        # (e.g. an export from before "teams" existed) silently becomes an
        # empty list rather than raising or exiting.
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "sparse.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump({}, f)
            result = clip_downloader.load_json(path)
        self.assertEqual(result, ([], [], [], []))


class MatchByNameTests(unittest.TestCase):
    def test_exact_match_wins_over_substring(self):
        items = [{"name": "Offence"}, {"name": "Offence B"}]
        self.assertEqual(
            clip_downloader.match_by_name(items, "name", "Offence"), [{"name": "Offence"}]
        )

    def test_case_insensitive(self):
        items = [{"name": "Offence"}]
        self.assertEqual(clip_downloader.match_by_name(items, "name", "OFFENCE"), items)
        self.assertEqual(clip_downloader.match_by_name(items, "name", "offence"), items)

    def test_substring_fallback_when_no_exact_match(self):
        items = [{"name": "Offence"}, {"name": "Defence"}]
        self.assertEqual(
            clip_downloader.match_by_name(items, "name", "Off"), [{"name": "Offence"}]
        )

    def test_no_match_returns_empty_list(self):
        items = [{"name": "Offence"}]
        self.assertEqual(clip_downloader.match_by_name(items, "name", "Special Teams"), [])

    def test_missing_key_defaults_to_empty_string(self):
        items = [{"other": "x"}]
        self.assertEqual(clip_downloader.match_by_name(items, "name", "anything"), [])

    def test_none_value_matches_literal_none_string(self):
        # i.get(key, "") returns None (not the default) when the key is
        # present with a JSON null, and str(None) is "None".
        items = [{"name": None}]
        self.assertEqual(clip_downloader.match_by_name(items, "name", "None"), items)

    def test_empty_search_matches_items_with_empty_or_missing_field_only(self):
        items = [{"name": ""}, {"name": "Offence"}]
        self.assertEqual(clip_downloader.match_by_name(items, "name", ""), [{"name": ""}])

    def test_empty_search_matches_everything_when_no_item_has_an_empty_field(self):
        # Only reached when no item exact-matches "" — otherwise this
        # substring-fallback-matches-all behavior never triggers.
        items = [{"name": "Offence"}, {"name": "Defence"}]
        self.assertEqual(clip_downloader.match_by_name(items, "name", ""), items)


class PickTeamTests(unittest.TestCase):
    def setUp(self):
        self.teams = [
            {"id": "t1", "name": "U16 Girls A"},
            {"id": "t2", "name": "U16 Girls B"},
        ]

    def test_single_exact_match_returns_team(self):
        self.assertEqual(clip_downloader.pick_team(self.teams, "u16 girls a"), self.teams[0])

    def test_single_substring_match_returns_team(self):
        teams = [{"id": "t1", "name": "U16 Girls"}]
        self.assertEqual(clip_downloader.pick_team(teams, "girls"), teams[0])

    def test_no_match_exits_1_and_lists_available_teams(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            with self.assertRaises(SystemExit) as cm:
                clip_downloader.pick_team(self.teams, "U18 Boys")
        self.assertEqual(cm.exception.code, 1)
        out = buf.getvalue()
        self.assertIn("No team matching 'U18 Boys'", out)
        self.assertIn("Available teams:", out)

    def test_ambiguous_match_exits_1_and_lists_available_teams(self):
        # Both failure paths behave the same way: "no match" and "ambiguous
        # match" each print their own explanation and then fall through to
        # the shared "Available teams" listing before exiting.
        buf = io.StringIO()
        with redirect_stdout(buf):
            with self.assertRaises(SystemExit) as cm:
                clip_downloader.pick_team(self.teams, "U16 Girls")
        self.assertEqual(cm.exception.code, 1)
        out = buf.getvalue()
        self.assertIn("Ambiguous team name 'U16 Girls'", out)
        self.assertIn("Available teams:", out)


class PickGameTests(unittest.TestCase):
    def setUp(self):
        self.games = [
            {"id": "g1", "title": "Round 1 vs Eagles"},
            {"id": "g2", "title": "Round 1 vs Hawks"},
        ]

    def test_single_exact_match_returns_game(self):
        self.assertEqual(
            clip_downloader.pick_game(self.games, "round 1 vs eagles"), self.games[0]
        )

    def test_single_substring_match_returns_game(self):
        games = [{"id": "g1", "title": "Round 1 vs Eagles"}]
        self.assertEqual(clip_downloader.pick_game(games, "eagles"), games[0])

    def test_no_match_exits_1_and_lists_available_games(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            with self.assertRaises(SystemExit) as cm:
                clip_downloader.pick_game(self.games, "Round 9 vs Sharks")
        self.assertEqual(cm.exception.code, 1)
        out = buf.getvalue()
        self.assertIn("No game matching 'Round 9 vs Sharks'", out)
        self.assertIn("Available games:", out)

    def test_ambiguous_match_exits_1_and_lists_available_games(self):
        # Both failure paths behave the same way: "no match" and "ambiguous
        # match" each print their own explanation and then fall through to
        # the shared "Available games" listing before exiting.
        buf = io.StringIO()
        with redirect_stdout(buf):
            with self.assertRaises(SystemExit) as cm:
                clip_downloader.pick_game(self.games, "Round 1")
        self.assertEqual(cm.exception.code, 1)
        out = buf.getvalue()
        self.assertIn("Ambiguous game name 'Round 1'", out)
        self.assertIn("Available games:", out)


class SelectClipsTests(unittest.TestCase):
    def setUp(self):
        self.teams, self.games, self.playlists, self.clips = _library()

    def _labels(self, clips):
        return [c["label"] for c in clips]

    def test_no_filters_returns_everything(self):
        selected, label = clip_downloader.select_clips(
            self.teams, self.games, self.playlists, self.clips, None, None, None
        )
        self.assertEqual(selected, self.clips)
        self.assertEqual(label, "All clips")

    def test_team_filter_narrows_to_that_teams_clips(self):
        selected, label = clip_downloader.select_clips(
            self.teams, self.games, self.playlists, self.clips, "U16 Girls", None, None
        )
        self.assertEqual(self._labels(selected), ["Clip A", "Clip B", "Clip C"])
        self.assertEqual(label, "U16 Girls")

    def test_team_filter_matches_case_insensitively_and_by_substring(self):
        selected, _ = clip_downloader.select_clips(
            self.teams, self.games, self.playlists, self.clips, "u16", None, None
        )
        self.assertEqual(self._labels(selected), ["Clip A", "Clip B", "Clip C"])

    def test_game_filter_narrows_to_one_game(self):
        selected, label = clip_downloader.select_clips(
            self.teams, self.games, self.playlists, self.clips,
            None, "Round 1 vs Eagles", None,
        )
        self.assertEqual(self._labels(selected), ["Clip A", "Clip B"])
        self.assertEqual(label, "Round 1 vs Eagles")

    def test_playlist_alone_matches_across_every_game(self):
        # Deliberate, documented behavior (README): --playlist with no
        # --team/--game pulls that category for the whole export, across
        # both teams here.
        with redirect_stdout(io.StringIO()):
            selected, label = clip_downloader.select_clips(
                self.teams, self.games, self.playlists, self.clips, None, None, "Offence"
            )
        self.assertEqual(self._labels(selected), ["Clip A", "Clip C", "Clip D"])
        self.assertEqual(label, "Offence")

    def test_playlist_plus_game_narrows_to_one_game(self):
        selected, label = clip_downloader.select_clips(
            self.teams, self.games, self.playlists, self.clips,
            None, "Round 1 vs Eagles", "Offence",
        )
        self.assertEqual(self._labels(selected), ["Clip A"])
        self.assertEqual(label, "Round 1 vs Eagles · Offence")

    def test_playlist_plus_team_narrows_to_that_teams_games(self):
        selected, label = clip_downloader.select_clips(
            self.teams, self.games, self.playlists, self.clips,
            "U14 Boys", None, "Offence",
        )
        self.assertEqual(self._labels(selected), ["Clip D"])
        self.assertEqual(label, "U14 Boys · Offence")

    def test_team_name_matching_nothing_exits_with_a_useful_message(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            with self.assertRaises(SystemExit) as cm:
                clip_downloader.select_clips(
                    self.teams, self.games, self.playlists, self.clips,
                    "Special Teams", None, None,
                )
        self.assertEqual(cm.exception.code, 1)
        self.assertIn("No team matching 'Special Teams'", buf.getvalue())

    def test_playlist_name_matching_nothing_exits_with_a_useful_message(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            with self.assertRaises(SystemExit) as cm:
                clip_downloader.select_clips(
                    self.teams, self.games, self.playlists, self.clips,
                    None, None, "Special Teams",
                )
        self.assertEqual(cm.exception.code, 1)
        self.assertIn("No playlist named 'Special Teams'", buf.getvalue())

    def test_ambiguous_playlist_match_is_not_an_error(self):
        # Unlike --team/--game, several distinctly-named playlist matches
        # (here "Offence" and "Offside", both substrings of "Off") are
        # unioned rather than rejected as ambiguous. This is the code's
        # current behavior, not something the README promises by name.
        teams, games, playlists, clips = _library()
        playlists.append({"id": "p5", "name": "Offside", "gameId": "g2"})
        clips.append({"gameId": "g2", "playlistId": "p5", "videoId": "vid2", "label": "Clip E"})

        buf = io.StringIO()
        with redirect_stdout(buf):
            selected, label = clip_downloader.select_clips(
                teams, games, playlists, clips, None, None, "Off"
            )
        self.assertEqual(
            {c["label"] for c in selected}, {"Clip A", "Clip C", "Clip D", "Clip E"}
        )
        self.assertEqual(label, "Offence / Offside")
        self.assertIn("matched", buf.getvalue())

    def test_team_filter_on_export_with_no_teams_exits(self):
        with redirect_stdout(io.StringIO()):
            with self.assertRaises(SystemExit) as cm:
                clip_downloader.select_clips([], [], [], [], "Anyone", None, None)
        self.assertEqual(cm.exception.code, 1)

    def test_game_filter_on_export_with_no_games_exits(self):
        with redirect_stdout(io.StringIO()):
            with self.assertRaises(SystemExit) as cm:
                clip_downloader.select_clips([], [], [], [], None, "Anyone", None)
        self.assertEqual(cm.exception.code, 1)


class SafeFilenameTests(unittest.TestCase):
    def test_windows_illegal_characters_are_stripped(self):
        self.assertEqual(clip_downloader.safe_filename('a<b>c:d"e/f\\g|h?i*j'), "abcdefghij")

    def test_path_separators_are_stripped(self):
        self.assertEqual(clip_downloader.safe_filename("../../etc/passwd"), "etcpasswd")

    def test_dots_are_removed_everywhere_not_just_the_edges(self):
        self.assertEqual(clip_downloader.safe_filename("...dots...everywhere..."), "dotseverywhere")

    def test_leading_and_trailing_whitespace_is_stripped(self):
        self.assertEqual(clip_downloader.safe_filename("  clip name  "), "clip_name")

    def test_leading_and_trailing_hyphens_and_underscores_survive(self):
        # Only whitespace is .strip()-ed; hyphens and underscores are kept
        # characters, so they are not trimmed the way whitespace is.
        self.assertEqual(clip_downloader.safe_filename("-_-clip-_-"), "-_-clip-_-")

    def test_unicode_in_team_and_clip_names_is_preserved(self):
        self.assertEqual(
            clip_downloader.safe_filename("Straße Zürich – 中文 café"),
            "Straße_Zürich_中文_café",
        )

    def test_empty_string_falls_back_to_clip(self):
        self.assertEqual(clip_downloader.safe_filename(""), "clip")

    def test_whitespace_only_falls_back_to_clip(self):
        self.assertEqual(clip_downloader.safe_filename("   \t\n  "), "clip")

    def test_all_illegal_characters_falls_back_to_clip(self):
        self.assertEqual(clip_downloader.safe_filename("///\\:::***???"), "clip")

    def test_internal_whitespace_collapses_to_single_underscore(self):
        self.assertEqual(clip_downloader.safe_filename("a   b\tc\nd"), "a_b_c_d")

    def test_long_name_is_truncated_to_60_chars(self):
        result = clip_downloader.safe_filename("x" * 100)
        self.assertEqual(result, "x" * 60)

    def test_windows_reserved_device_name_is_not_specially_handled(self):
        # safe_filename has no guard against Windows reserved device names
        # (CON, NUL, COM1, ...); documenting the gap, not asserting a fix.
        self.assertEqual(clip_downloader.safe_filename("CON"), "CON")


class ExtractVideoIdTests(unittest.TestCase):
    def test_standard_watch_url(self):
        self.assertEqual(
            clip_downloader.extract_video_id("https://www.youtube.com/watch?v=abc123"), "abc123"
        )

    def test_watch_url_with_extra_query_params(self):
        self.assertEqual(
            clip_downloader.extract_video_id(
                "https://www.youtube.com/watch?v=abc123&list=PLxyz&index=2"
            ),
            "abc123",
        )

    def test_short_url(self):
        self.assertEqual(clip_downloader.extract_video_id("https://youtu.be/abc123"), "abc123")

    def test_short_url_with_query_string(self):
        self.assertEqual(clip_downloader.extract_video_id("https://youtu.be/abc123?t=42"), "abc123")

    def test_embed_url(self):
        self.assertEqual(
            clip_downloader.extract_video_id("https://www.youtube.com/embed/abc123?rel=0"),
            "abc123",
        )

    def test_shorts_url(self):
        self.assertEqual(
            clip_downloader.extract_video_id("https://www.youtube.com/shorts/abc123"), "abc123"
        )

    def test_old_style_v_path_url(self):
        self.assertEqual(
            clip_downloader.extract_video_id("https://www.youtube.com/v/abc123"), "abc123"
        )

    def test_mobile_subdomain(self):
        self.assertEqual(
            clip_downloader.extract_video_id("https://m.youtube.com/watch?v=xyz789"), "xyz789"
        )

    def test_url_with_no_recognizable_video_id_returns_none(self):
        # /live/ URLs are a real YouTube shape but not one of the patterns
        # this function recognizes.
        self.assertIsNone(clip_downloader.extract_video_id("https://www.youtube.com/live/abc123"))

    def test_non_url_text_returns_none(self):
        self.assertIsNone(clip_downloader.extract_video_id("not a url at all"))

    def test_v_param_is_matched_on_any_domain_not_just_youtube(self):
        # The [?&]v=(...) pattern isn't anchored to a YouTube domain, so it
        # matches a v= query param on any URL. Documented as a known
        # surprise in the current implementation, not a guarantee.
        self.assertEqual(
            clip_downloader.extract_video_id("https://example.com/foo?v=notarealvideoid"),
            "notarealvideoid",
        )


class FmtTimeTests(unittest.TestCase):
    def test_zero(self):
        self.assertEqual(clip_downloader.fmt_time(0), "0:00")

    def test_sub_minute(self):
        self.assertEqual(clip_downloader.fmt_time(5), "0:05")
        self.assertEqual(clip_downloader.fmt_time(59), "0:59")

    def test_minutes_no_hour(self):
        self.assertEqual(clip_downloader.fmt_time(65), "1:05")
        self.assertEqual(clip_downloader.fmt_time(599), "9:59")
        self.assertEqual(clip_downloader.fmt_time(600), "10:00")

    def test_past_an_hour(self):
        self.assertEqual(clip_downloader.fmt_time(3600), "1:00:00")
        self.assertEqual(clip_downloader.fmt_time(3661), "1:01:01")
        self.assertEqual(clip_downloader.fmt_time(7325), "2:02:05")

    def test_fractional_seconds_are_truncated_not_rounded(self):
        self.assertEqual(clip_downloader.fmt_time(59.9), "0:59")
        self.assertEqual(clip_downloader.fmt_time(65.9), "1:05")


class GroupByVideoTests(unittest.TestCase):
    def test_groups_clips_by_video_id(self):
        clips = [
            {"videoId": "vid1", "label": "A"},
            {"videoId": "vid2", "label": "B"},
            {"videoId": "vid1", "label": "C"},
        ]
        with redirect_stdout(io.StringIO()):
            grouped = clip_downloader.group_by_video(clips)
        self.assertEqual(
            grouped,
            {
                "https://www.youtube.com/watch?v=vid1": [clips[0], clips[2]],
                "https://www.youtube.com/watch?v=vid2": [clips[1]],
            },
        )

    def test_preserves_first_encounter_order(self):
        clips = [{"videoId": "vid2", "label": "A"}, {"videoId": "vid1", "label": "B"}]
        with redirect_stdout(io.StringIO()):
            grouped = clip_downloader.group_by_video(clips)
        self.assertEqual(
            list(grouped.keys()),
            ["https://www.youtube.com/watch?v=vid2", "https://www.youtube.com/watch?v=vid1"],
        )

    def test_legacy_clips_without_video_id_prompt_for_a_url(self):
        clips = [{"label": "Old clip"}]
        with patch("builtins.input", return_value="https://youtu.be/legacy123"), \
                redirect_stdout(io.StringIO()):
            grouped = clip_downloader.group_by_video(clips)
        self.assertEqual(grouped, {"https://www.youtube.com/watch?v=legacy123": clips})

    def test_legacy_clips_merge_into_a_matching_existing_group(self):
        clips = [{"videoId": "vid1", "label": "A"}, {"label": "Old clip"}]
        with patch("builtins.input", return_value="https://youtu.be/vid1"), \
                redirect_stdout(io.StringIO()):
            grouped = clip_downloader.group_by_video(clips)
        self.assertEqual(grouped, {"https://www.youtube.com/watch?v=vid1": [clips[0], clips[1]]})

    def test_legacy_clips_with_unparseable_url_use_the_raw_string_as_key(self):
        clips = [{"label": "Old clip"}]
        with patch("builtins.input", return_value="not a url"), redirect_stdout(io.StringIO()):
            grouped = clip_downloader.group_by_video(clips)
        self.assertEqual(grouped, {"not a url": clips})

    def test_empty_url_input_exits_1(self):
        with patch("builtins.input", return_value=""), redirect_stdout(io.StringIO()):
            with self.assertRaises(SystemExit) as cm:
                clip_downloader.group_by_video([{"label": "Old clip"}])
        self.assertEqual(cm.exception.code, 1)


if __name__ == "__main__":
    unittest.main()
