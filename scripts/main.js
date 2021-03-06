/*
FUNCTIONS LIST

rebuild_list
rebuild_totals
rebuild_charts
verify_custom_sound
check_width
tools_pulsate
SaveTasks
*/

var app, version, lang, load, background = false, autosaves = 0,  dragging = false, preview_sound = false; // General variables
var alarm_open = false, task_open = false, tools_open = false, dialog_open = false; // Menu state variables
var js_error_shown = false, no_local_files_alerted = false; // Alert state variables
var current_plot, total_plot; // Plot variables
var save_timer, timer, timer_step = 0; // Timer variables
var DEBUG = false; // Debug mode

// Set error event (most important event)
window.onerror = function(msg, url, line) { js_error(msg, url, line); };

// Document finished loading
$(function() {
    try {
        // Set some variables
        app = chrome.app.getDetails();
        version = app.version;
        lang = window.navigator.language;
        load = $('#loading');

        // Localise ALL the things!
        localisePage();

        // Show translations text
        if(lang != 'en' && lang != 'en-CA' && lang != 'en-GB' && lang != 'en-US') $('#translations-accuracy').show();

        // Check to see if the app is already opened
        if(Setting('opened', false, true)) throw 'open';
        Setting('opened', true);

        // Load settings
        LoadSettings();

        // If coming from a version older than 3.6, convert the stop-timer setting to no-overtime
        if(typeof localStorage['old-version'] !== 'undefined' && version_compare('3.6.0', localStorage['old-version']) === -1) {
            if(!Setting('stop-timer', true, true)) {
                Setting('no-overtime', false);
                Setting('stop-timer', true);
            }
        }

        // Check the version, and show the changelog if necessary
        if(typeof localStorage['old-version'] != 'undefined') {
            if(version != localStorage['old-version']) {
                dialog(locale('confUpdated', version) + (!Setting('background-running') ? '\n'+ locale('confUpdatedRestartAddendum') : ''), function(status) {
                    if(status) window.open('about.html#changelog');
                }, {}, 'question', false, true);
            }
        }

        // Set old-version to the current version
        localStorage['old-version'] = version;

        // Add to the launch count
        var launches = Setting('launches', Setting('launches', 0, true) + 1);

        // Show a rating reminder if at a multiple of 6 launches
        if(launches % 6 === 0 && typeof localStorage['rated'] == 'undefined') {
            dialog(locale('confRating'), function(status) {
                if(status) {
                    localStorage['rated'] = 'true';
                    window.open('https://chrome.google.com/webstore/detail/task-timer/aomfjmibjhhfdenfkpaodhnlhkolngif/reviews');
                }
            }, {}, 'question');
        }




        // Retrieve tasks from localStorage
        if(localStorage['tasks']) {
            tasks = JSON.parse(localStorage['tasks']);
            task_count = tasks.length;

            for(var i = 0; i < task_count; i++) {
                // Convert from the old method of storing times to the new one
                if(typeof tasks[i].current_hours == 'undefined') {
                    tasks[i].current_hours = Math.floor(tasks[i].current);
                    tasks[i].current_mins = Math.floor((tasks[i].current - tasks[i].current_hours) * 60);
                    tasks[i].current_secs = Math.round((tasks[i].current - tasks[i].current_hours - (tasks[i].current_mins / 60)) * 3600);

                    tasks[i].goal_hours = Math.floor(tasks[i].goal);
                    tasks[i].goal_mins = Math.round((tasks[i].goal - tasks[i].goal_hours) * 60);
                }

                // Delete the old time format properties
                if(typeof tasks[i].current != 'undefined') {
                    delete tasks[i].current;
                    delete tasks[i].goal;
                }

                // Add the notified property to a task if it doesn't exist
                if(typeof tasks[i].notified == 'undefined') {
                    if(tasks[i].current_hours >= tasks[i].goal_hours && tasks[i].current_mins >= tasks[i].goal_mins) {
                        tasks[i].notified = true;
                    } else {
                        tasks[i].notified = false;
                    }
                }

                // Add missing properties
                if(typeof tasks[i].indefinite == 'undefined') tasks[i].indefinite = false;
                if(typeof tasks[i].description == 'undefined') tasks[i].description = '';
                if(typeof tasks[i].settings == 'undefined' || tasks[i].settings === null) tasks[i].settings = {};
                if(typeof tasks[i].last_tick == 'undefined') tasks[i].last_tick = null;

                // Load the task settings for the task
                LoadTaskSettings(i);

                // Make sure goal times aren't null
                if(tasks[i].goal_hours === null) tasks[i].goal_hours = 0;
                if(tasks[i].goal_mins === null) tasks[i].goal_mins = 0;

                // Clear the last tick if the app shouldn't run in the background
                if(!Setting('background-running')) tasks[i].last_tick = null;

                list_task(i, 0);
            }
        }

        // Retrieve tasks from Chrome's storage
        RetrieveTasks();

        // Start the timers
        update_time();
        save_timer = setTimeout(function() { SaveTasks(true); }, 60000);




        // Enable the add task fields
        $('#new-task input, #new-task button').removeAttr('disabled');

        // Check the auto-start box if enabled, and fill in the new task fields if enabled
        if(Setting('autostart-default')) $('#new-start').attr('checked', 'checked');
        if(Setting('save-fields')) {
            $('#new-txt').val(Setting('field-name', '', true));
            $('#new-goal-hours').val(Setting('field-hours', '4', true));
            $('#new-goal-mins').val(Setting('field-mins', '0', true));

            if(Setting('field-start', false, true)) $('#new-start').attr('checked', 'checked');
            if(Setting('field-indef', false, true)) {
                $('#new-goal-indef').attr('checked', 'checked');
                $('#new-goal-hours').attr('disabled', 'disabled');
                $('#new-goal-mins').attr('disabled', 'disabled');
            }
        }

        // Set focus on the new task name field
        setTimeout(function() { $('#new-txt').focus(); }, 100);

        // Make the table rows draggable
        $('table#task-list').tableDnD({
            dragHandle: 'drag',

            /*onDragStart: function(table, row) {
                alert($(row).html());
                var id = parseInt($(row).attr('id').replace('task-', ''));
                dragging = tasks[id];
            },*/

            onDrop: function(table, row) {
                var old_id = parseInt($(row).attr('id').replace('task-', ''), 10);
                var id = $('table#task-list tbody tr').index(row);
                var tmp = tasks[old_id];

                if(typeof tasks[old_id] != 'undefined' /*&& tasks[old_id] === dragging*/) {
                    tasks.splice(old_id, 1);
                    tasks.splice(id, 0, tmp);
                }

                rebuild_list();
            }
        });

        // Add the history date picker
        $('#date-picker').datepicker({
            firstDay: 1,
            dateFormat: 'yy-mm-dd',

            onSelect: function(dateText, inst) {
                date = dateText.split('-');
                show_history(parseInt(date[0], 10), parseInt(date[1], 10), parseInt(date[2], 10));
            }
        });

        // Show and update everything
        $('div#tasks').show();
        tools_pulsate();
        rebuild_totals();
        rebuild_charts();
        check_width();
        if(DEBUG) $('#debug').show();
    } catch(e) {
        js_error(e);
    }










    function update_current_time (task) {
        var today = new Date();
        var current_month = today.getMonth();
        var current_year = today.getFullYear();
        var current_day = today.getDate();
        var day_totals = 0;
        $.each(tasks[task].history[current_year][current_month][current_day], function() {
            day_totals += this.secs;
            day_totals += this.mins * 60;
            day_totals += this.hours * 60 * 60;
        });
        var h = Math.floor(s/3600); //Get whole hours
        day_totals -= h*3600;
        var m = Math.floor(s/60); //Get remaining minutes
        day_totals -= m*60;

        tasks[task].current_hours = h;
        tasks[task].current_mins = m;
        tasks[task].current_secs = day_totals;

        // $('#totals-history tbody').empty();
        // $('<tr />')
        //     .append('<td>'+ secondsTimeSpanToHMS(day_totals) +'</td>')
        //     .appendTo('#totals-history tbody');
    }



    var options = $("#options");
        $.each(tasks, function() {
            options.append($("<option />").val(this.text).text(this.text));
    });

    $('#options-row-template').clone().attr('id', 'options-task').appendTo('table#task-list tbody');
    $('#options-task').show();

    $( "#options" )
        .change(function () {
            var task_num = 0;
            var selected_option = $( "#options option:selected" );
            var selected_option_text = selected_option[0].text;
            console.log(selected_option_text);
            $( "#options option:selected" ).each(function() {
                update_task_text(task_num);
            });
            $.each(tasks, function() {
                if (selected_option_text == this.text) {
                    console.log("match");
                    update_task_text(task_num);
                } else {
                    task_num++;
                }      
            })
        });

            $( "#totals-options" )
                .change(function () {

                    var selected_option = $( "#totals-options option:selected" );
                    var selected_option_text = selected_option[0].text;

                    get_totals(selected_option_text)
                ;
            })

      function update_task_text(task) {
        console.log("update_task_text");
        // Text
        $('#options-task td.current').text(format_time(tasks[task].current_hours, tasks[task].current_mins, tasks[task].current_secs));
        $('#options-task td.goal').text(format_time(tasks[task].goal_hours, tasks[task].goal_mins, 0, tasks[task].indefinite));
        $('options-task button.toggle').text(tasks[task].last_tick ? locale('btnStop') : locale('btnStart'));
        $('options-task img.toggle').attr('title', tasks[task].last_tick ? locale('btnStop') : locale('btnStart')).attr('src', 'style/images/control_'+ (tasks[task].last_tick ? 'pause' : 'play') +'_blue.png');

        // Unbind Events
        $('#options-task .toggle').unbind();
        $('#options-task .info').unbind();
        $('#options-task .reset').unbind();
        $('#options-task .delete').unbind();

              // Option Buttons
        $('#options-task .toggle').attr('name', task).click(function() {
            if(!$(this).hasClass('disabled')) toggle_task(parseInt($(this).attr('name'), 10), true);
        });
        $('#options-task .info').attr('name', task).click(function() {
            if(!$(this).hasClass('disabled')) task_info(parseInt($(this).attr('name'), 10), true, true, false);
        });
        $('#options-task .reset').attr('name', task).click(function() {
            if(!$(this).hasClass('disabled')) reset_task(parseInt($(this).attr('name'), 10));
        });
        $('#options-task .delete').attr('name', task).click(function() {
            if(!$(this).hasClass('disabled')) {
                cancel_edit();
                delete_task(parseInt($(this).attr('name'), 10));
            }
        });
      }






});

function rebuild_options_list() {
    $('#options-row-template').clone().attr('id', 'options-task').appendTo('table#task-list tbody');
    $('#options-task').show();

    var options = $("#options");
    options.empty();
    $.each(tasks, function() {
            options.append($("<option />").val(this.text).text(this.text));
    });
}















// Rebuild the task list
function rebuild_list() {
    var scroll = $(window).scrollTop();
    editing_task = -1;
    $('table#task-list tbody').empty().removeClass('editing-name editing-current editing-goal');

    for(var i = 0; i < task_count; i++) {
        list_task(i, 0);
    }

    rebuild_options_list();

    $(window).scrollTop(scroll);
    $('table#task-list').tableDnDUpdate();
    rebuild_totals();
    rebuild_charts();



}


// Rebuild the totals row
function rebuild_totals() {
    if(task_count > 0) {
        var current_hours = 0, current_mins = 0, current_secs = 0, goal_hours = 0, goal_mins = 0, dec_current = 0, dec_this_current, dec_this_goal, progress, i;

        // Get the total hours, minutes, and seconds
        for(var t = 0; t < task_count; t++) {
            if(!TaskSetting('exclude-totals', t)) {
                current_hours += tasks[t].current_hours;
                current_mins += tasks[t].current_mins;
                current_secs += tasks[t].current_secs;

                if(!tasks[t].indefinite) {
                    goal_hours += tasks[t].goal_hours;
                    goal_mins += tasks[t].goal_mins;

                    // Don't add excess time spent
                    dec_this_current = tasks[t].current_hours + (tasks[t].current_mins / 60) + (tasks[t].current_secs / 3600);
                    dec_this_goal = tasks[t].goal_hours + (tasks[t].goal_mins / 60);
                    dec_current += dec_this_current > dec_this_goal ? dec_this_goal : dec_this_current;
                }
            }
        }

        // Fix things like 12:72:142
        if(current_secs > 59) {
            current_mins += Math.floor(current_secs / 60);
            current_secs %= 60;
        }
        if(current_mins > 59) {
            current_hours += Math.floor(current_mins / 60);
            current_mins %= 60;
        }
        if(goal_mins > 59) {
            goal_hours += Math.floor(goal_mins / 60);
            goal_mins %= 60;
        }

        // Get the total progress done
        progress = Math.floor(dec_current / (goal_hours + (goal_mins / 60)) * 100);
        if(isNaN(progress)) progress = 0;

        // Display
        $('table#task-list tfoot td.current').text(format_time(current_hours, current_mins, current_secs));
        $('table#task-list tfoot td.goal').text(format_time(goal_hours, goal_mins, 0));
        $('table#task-list tfoot progress').text(progress.toString() + '%').val(progress);

        if(task_count >= 2) $('table#task-list tfoot').fadeIn(); else $('table#task-list tfoot').fadeOut();
    }
}

// Update the pie charts
function rebuild_charts() {
    if(Setting('enable-charts') && typeof tasks[0] != 'undefined') {
        var plot_data = [], total_time = 0, t, i;

        // Get the total of all times
        for(t = 0; t < task_count; t++) {
            if(!TaskSetting('exclude-charts', t)) total_time += (tasks[t].current_hours) + (tasks[t].current_mins / 60) + (tasks[t].current_secs / 3600);
        }

        // Display charts container
        if(total_time > 0) $('#charts').fadeIn(); else $('#charts').fadeOut();

        // Build the time spent chart
        i = 0;
        for(t = 0; t < task_count; t++) {
            if(!TaskSetting('exclude-charts', t)) {
                plot_data[i] = {
                    label: tasks[t].text,
                    data: ((tasks[t].current_hours) + (tasks[t].current_mins / 60) + (tasks[t].current_secs / 3600)) / total_time * 100
                };

                i++;
            }
        }


        // Display the time spent chart
        current_plot = $.plot($('#current-pie-chart'), plot_data, {
            series: {
                pie: {
                    show: true,
                    combine: Setting('chart-combine', false, true) ? {
                        label: locale('txtOther'),
                        color: '#999',
                        threshold: 0.03
                    } : {},
                    label: {
                        show: true,
                        radius: 3 / 4,
                        formatter: function(label, series) {
                            return '<div style="font-size: 8pt; text-align: center; padding: 2px; color: white;">' + label + (Setting('chart-show-percent', true, true) ? '<br />' + Math.round(series.percent) + '%' : '') + '</div>';
                        },
                        background: {
                            opacity: 0.5,
                            color: '#000'
                        },
                        threshold: 0.05
                    }
                }
            },

            legend: {
                show: false
            },

            grid: {
                hoverable: true
            }
        });
    } else {
        $('#charts').fadeOut();
    }
}

// Verify the format of the custom sound URL
function verify_custom_sound(from_btn) {
    if($('#play-sound').attr('checked') && $('#sound-type').val() == 2) {
        var url = $('#custom-sound').val();

        if(url.match(/^(((ht|f)tp(s?))\:\/\/).+$/i)) {
            // URLs! Interwebs!
            $('#custom-sound').removeClass('invalid');
            return true;
        } else if(url.match(/^(file\:\/\/)?(([a-z]\:(\\|\/))|\/).+$/i) && (!no_local_files_alerted || from_btn)) {
            // Local files can't be used
            alert(locale('noteNoLocalFiles'));
            no_local_files_alerted = true;
        } else {
            // No format recognised
            $('#custom-sound').addClass('invalid');
        }

        return false;
    } else {
        $('#custom-sound').removeClass('invalid');
        return true;
    }
}

// Check window width - if it's small, ask if they want to use icons
function check_width() {
    if($(window).width() < 1440) {
        if(!Setting('small-window-alerted', false, true) && !Setting('use-icons') && confirm(locale('confSmallWindow'))) {
            Setting('use-icons', true);
            LoadSettings();
        }

        Setting('small-window-alerted', true);
    }
}

// The little pulsate effect on the tools button
function tools_pulsate() {
    if(Setting('new-tools', true, true)) {
        $('#tools-pulsate').animate({width: '150px', height: '150px'}, 800).animate({width: '75px', height: '75px'}, 800);
        setTimeout(tools_pulsate, 1600);
    }
}

// Save the task data in localStorage
function SaveTasks(timeout) {
    if(timeout) load.show();
    $('button.delete, #new-btn').attr('disabled', 'disabled');

    // Save task data
    localStorage['tasks'] = JSON.stringify(tasks);

    // Save current new task field contents
    if(Setting('save-fields')) {
        Setting('field-name', $('#new-txt').val());
        Setting('field-hours', $('#new-goal-hours').val());
        Setting('field-mins', $('#new-goal-mins').val());
        Setting('field-indef', $('#new-goal-indef').is(':checked'));
        Setting('field-start', $('#new-start').is(':checked'));
    }

    // Increment the autosave counter
    if(timeout) { autosaves++; }

    // Sync every 10 autosaves
    if(!timeout || autosaves % 10 === 0 || !synced) {
        SendTasks();
        synced = true;
    }

    // Timeout
    clearTimeout(save_timer);
    save_timer = setTimeout(function() { SaveTasks(true); }, 60000);

    $('button.delete, #new-btn').removeAttr('disabled');
    if(timeout) load.hide();
}