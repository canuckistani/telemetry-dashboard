var gInitialPageState = null;
var gFilterChangeTimeout = null;
var gCurrentHistogramsList = null; gCurrentDates = null;
var gCurrentMinDate = null, gCurrentMaxDate = null;
var gFilters = null, gPreviousFilterAllSelected = {};

indicate("Initializing Telemetry...");

$(function() { Telemetry.init(function() {
  gFilters = {
    "application":  $("#filter-product"),
    "os":           $("#filter-os"),
    "architecture": $("#filter-arch"),
    "e10sEnabled":  $("#filter-e10s"),
    "child"      :  $("#filter-process-type"),
  };
  gInitialPageState = loadStateFromUrlAndCookie();
  
  // Set up settings selectors
  multiselectSetOptions($("#channel-version"), getHumanReadableOptions("channelVersion", Telemetry.getVersions()));
  if (gInitialPageState.max_channel_version !== undefined) { $("#channel-version").multiselect("select", gInitialPageState.max_channel_version); }
  if (gInitialPageState.compare !== undefined) { $("#compare").multiselect("select", gInitialPageState.compare); }
  
  $("input[name=cumulative-toggle][value=" + (gInitialPageState.cumulative !== 0 ? 1 : 0) + "]").prop("checked", true).trigger("change");
  $("input[name=build-time-toggle][value=" + (gInitialPageState.use_submission_date !== 0 ? 1 : 0) + "]").prop("checked", true).trigger("change");
  $("input[name=sanitize-toggle][value=" + (gInitialPageState.sanitize !== 0 ? 1 : 0) + "]").prop("checked", true).trigger("change");
  
  updateOptions(function() {
    $("#filter-product").multiselect("select", gInitialPageState.product);
    if (gInitialPageState.arch !== null) { $("#filter-arch").multiselect("select", gInitialPageState.arch); }
    else { $("#filter-arch").multiselect("selectAll", false).multiselect("updateButtonText"); }
    if (gInitialPageState.e10s !== null) { $("#filter-e10s").multiselect("select", gInitialPageState.e10s); }
    else { $("#filter-e10s").multiselect("selectAll", false).multiselect("updateButtonText"); }
    if (gInitialPageState.processType !== null) { $("#filter-process-type").multiselect("select", gInitialPageState.processType); }
    else { $("#filter-process-type").multiselect("selectAll", false).multiselect("updateButtonText"); }
    
    if (gInitialPageState.os !== null) { // We accept values such as "WINNT", as well as "WINNT,6.1"
      $("#filter-os").multiselect("select", expandOSs(gInitialPageState.os));
    } else { $("#filter-os").multiselect("selectAll", false).multiselect("updateButtonText"); }
    
    for (var filterName in gFilters) {
      var selector = gFilters[filterName];
      if (selector.is("[multiple]")) {
        var selected = selector.val() || [], options = selector.find("option");
        gPreviousFilterAllSelected[selector.attr("id")] = selected.length === options.length;
      }
    }
    
    $("#channel-version").change(function() {
      updateOptions(function() { $("#measure").trigger("change"); });
    });
    $("input[name=build-time-toggle], input[name=sanitize-toggle], #measure, #filter-product, #filter-os, #filter-arch, #filter-e10s, #filter-process-type, #compare").change(function(e) {
      var $this = $(this);
      if (gFilterChangeTimeout !== null) { clearTimeout(gFilterChangeTimeout); }
      gFilterChangeTimeout = setTimeout(function() { // Debounce the changes to prevent rapid filter changes from causing too many updates
        if ($this.is("[multiple]")) { // Only apply the select all change to controls that allow multiple selections
          // If options (but not all options) were deselected when previously all options were selected, invert selection to include only those deselected
          var selected = $this.val() || [], options = $this.find("option");
          if (selected.length !== options.length && selected.length > 0 && gPreviousFilterAllSelected[$this.attr("id")]) {
            var nonSelectedOptions = options.map(function(i, option) { return option.getAttribute("value"); }).toArray()
              .filter(function(filterOption) { return selected.indexOf(filterOption) < 0; });
            $this.multiselect("deselectAll").multiselect("select", nonSelectedOptions);
          }
          gPreviousFilterAllSelected[$this.attr("id")] = selected.length === options.length; // Store state
        }

        // Update CSS classes for labels marking whether they are all selected
        var allSelectedOSList = compressOSs().filter(function(os) { return os.indexOf(",") < 0; }); // List of all OSs that are all selected
        var selector = $("#filter-os").next().find(".multiselect-container");
        selector.find(".multiselect-group-clickable").removeClass("all-selected");
        var optionsMap = {};
        getHumanReadableOptions("os", allSelectedOSList).forEach(function(option) { optionsMap[option[0]] = option[1]; });
        allSelectedOSList.forEach(function(os) {
          var optionGroupLabel = selector.find(".multiselect-group-clickable:contains('" + optionsMap[os] + "')");
          optionGroupLabel.addClass("all-selected");
        });
        
        calculateHistograms(function(histogramsMap, evolutionsMap) {
          var description = $("#measure").val();
          for (var label in evolutionsMap) {
            description = evolutionsMap[label][0].description;
            break;
          }
          $("#measure-description").text(description);
          var histogramsList = [];
          for (var label in histogramsMap) {
            histogramsList.push({title: label, histograms: histogramsMap[label]});
          }
          gCurrentHistogramsList = histogramsList; gCurrentDates = evolutions.length === 0 ? null : evolutions[0].dates();
          displayHistograms(histogramsList, gCurrentDates, $("input[name=cumulative-toggle]:checked").val() !== "0");
          saveStateToUrlAndCookie();
        }, $("input[name=sanitize-toggle]:checked").val() !== "0");
      }, 0);
    });

    // Perform a full display refresh
    $("#measure").trigger("change");
  });

  $("input[name=cumulative-toggle]").change(function() {
    displayHistograms(gCurrentHistogramsList, gCurrentDates, $("input[name=cumulative-toggle]:checked").val() !== "0");
    saveStateToUrlAndCookie();
  });
  
  // Automatically resize range bar
  $(window).resize(function() {
    var dateControls = $("#date-range-controls");
    $("#range-bar").outerWidth(dateControls.parent().width() - dateControls.outerWidth() - 10);
  });
  $("#advanced-settings").on("shown.bs.collapse", function () {
    var dateControls = $("#date-range-controls");
    $("#range-bar").outerWidth(dateControls.parent().width() - dateControls.outerWidth() - 10);
    $(this).get(0).scrollIntoView({behavior: "smooth"}); // Scroll the advanced settings into view when opened
  });
}); });

function updateOptions(callback) {
  var channelVersion = $("#channel-version").val();
  var parts = channelVersion.split("/"); //wip: clean this up
  indicate("Updating options...");
  Telemetry.getFilterOptions(parts[0], parts[1], function(optionsMap) {
    multiselectSetOptions($("#measure"), getHumanReadableOptions("measure", deduplicate(optionsMap.metric)));
    $("#measure").multiselect("select", gInitialPageState.measure);

    multiselectSetOptions($("#filter-product"), getHumanReadableOptions("application", deduplicate(optionsMap.application)));
    multiselectSetOptions($("#filter-arch"), getHumanReadableOptions("architecture", deduplicate(optionsMap.architecture)));
    multiselectSetOptions($("#filter-e10s"), getHumanReadableOptions("e10sEnabled", deduplicate(optionsMap.e10sEnabled)));
    multiselectSetOptions($("#filter-process-type"), getHumanReadableOptions("child", deduplicate(optionsMap.child)));

    // Compressing and expanding the OSs also has the effect of making OSs where all the versions were selected also all selected in the new one, regardless of whether those versions were actually in common or not
    var selectedOSs = compressOSs();
    multiselectSetOptions($("#filter-os"), getHumanReadableOptions("os", deduplicate(optionsMap.os)));
    $("#filter-os").multiselect("select", expandOSs(selectedOSs));

    if (callback !== undefined) { indicate(); callback(); }
  });
}

function calculateHistograms(callback, sanitize) {
  // Get selected version, measure, and aggregate options
  var channelVersion = $("#channel-version").val();
  var measure = $("#measure").val();
  
  var comparisonName = $("#compare").val();
  var filterSetsMapping = getFilterSetsMapping(gFilters, comparisonName !== "" ? comparisonName : null); // Mapping from option values to lists of filter sets
  var totalFilters = 0;
  for (var option in filterSetsMapping) { totalFilters += filterSetsMapping[option].length; }
  
  var useSubmissionDate = $("input[name=build-time-toggle]:checked").val() !== "0";
  var fullEvolutionsMap = {}; // Mapping from labels (the keys in keyed histograms) to lists of combined filtered evolutions (one per comparison option, combined from all filter sets in that option)
  var optionValues = []; // List of options in the order that they were done being processed, rather than the order they appeared in
  var filterSetsCount = 0, totalFiltersCount = 0;
  var filterSetsMappingOptions = Object.keys(filterSetsMapping);
  filterSetsMappingOptions.forEach(function(filterSetsMappingOption, i) { // For each option being compared by
    var filterSets = filterSetsMapping[filterSetsMappingOption];
    var filtersCount = 0, fullEvolutionMap = {};
    indicate("Updating histograms... 0%");
    filterSets.forEach(function(filterSet) {
      var parts = channelVersion.split("/");
      Telemetry.getEvolution(parts[0], parts[1], measure, filterSet, useSubmissionDate, function(evolutionMap) {
        totalFiltersCount ++; filtersCount ++;
        indicate("Updating histograms... " + Math.round(100 * totalFiltersCount / totalFilters) + "%");
        
        for (var label in evolutionMap) {
          if (fullEvolutionMap.hasOwnProperty(label)) { fullEvolutionMap[label] = fullEvolutionMap[label].combine(evolutionMap[label]); }
          else { fullEvolutionMap[label] = evolutionMap[label]; }
        }
        
        if (filtersCount === filterSets.length) { // Check if we have loaded all the needed filters in the current filter set
          filterSetsCount ++;
          optionValues.push(filterSetsMappingOption); // Add the current option value being compared by
          for (var label in fullEvolutionMap) { // Make a list of evolutions for each label in the evolution
            if (!fullEvolutionsMap.hasOwnProperty(label)) { fullEvolutionsMap[label] = []; }
            if (sanitize) { fullEvolutionMap[label] = fullEvolutionMap[label].sanitized(); }
            fullEvolutionsMap[label].push(fullEvolutionMap[label]);
          }
          if (filterSetsCount === filterSetsMappingOptions.length) { // Check if we have loaded all the filter set collections
            indicate();
            var dates = null;
            for (var label in fullEvolutionsMap) {
              dates = fullEvolutionsMap[label][0].dates();
              break;
            }
            updateDateRange(function(dates) {
              if (dates == null) { // No dates in the selected range, so no histograms available
                callback({}, {});
              } else { // Filter the evolution to include only those histograms that are in the selected range
                var filteredEvolutionsMap = {}, filteredHistogramsMap = {};
                for (var label in fullEvolutionsMap) {
                  filteredEvolutionsMap[label] = fullEvolutionsMap[label].map(function(evolution) {
                    return evolution.dateRange(dates[0], dates[dates.length - 1]); // We don't need to worry about this returning null since the dates came from the evolution originally
                  });
                  filteredHistogramsMap[label] = filteredEvolutionsMap[label].map(function(evolution, i) {
                    var histogram = evolution.histogram();
                    if (comparisonName !== "") { // We are comparing by an option value
                      var humanReadableOption = getHumanReadableOptions(comparisonName, [optionValues[i]])[0][1];
                      histogram.measure = humanReadableOption;
                    }
                    return histogram;
                  });
                }
                callback(filteredHistogramsMap, filteredEvolutionsMap);
              }
            }, dates, false);
          }
        }
      });
    });
  });
  
  if (totalFilters === 0) { // No filters selected, so no histograms could be created
    indicate();
    updateDateRange(function(dates) {
      callback({}, {});
    }, [], false);
  }
}

var gLastTimeoutID = null;
var gLoadedDateRangeFromState = false;
var gCurrentDateRangeUpdateCallback = null;
var gPreviousMinMoment = null, gPreviousMaxMoment = null;
function updateDateRange(callback, dates, updatedByUser, shouldUpdateRangebar) { // dates is null for when there are no evolutions
  shouldUpdateRangebar = shouldUpdateRangebar === undefined ? true : shouldUpdateRangebar;

  gCurrentDateRangeUpdateCallback = callback || function() {};
  
  if (dates.length === 0) {
    $("#date-range").prop("disabled", true);
    $("#range-bar").hide();
    gCurrentDateRangeUpdateCallback(null);
    return;
  }
  $("#date-range").prop("disabled", false);
  $("#range-bar").show();
  
  var timeCutoff = moment.utc().add(1, "years").toDate().getTime();
  if (dates[dates.length - 1] > timeCutoff) { dates = dates.filter(function(date) { return date < timeCutoff }); }
  var minMoment = moment.utc(dates[0]).format("YYYY-MM-DD"), maxMoment = moment.utc(dates[dates.length - 1]).format("YYYY-MM-DD");
  gCurrentMinDate = minMoment, gCurrentMaxDate = maxMoment;

  // Update the start and end range and update the selection if necessary
  var picker = $("#date-range").data("daterangepicker");
  picker.setOptions({
    format: "YYYY/MM/DD",
    minDate: minMoment, maxDate: maxMoment,
    showDropdowns: true,
    drops: "up", opens: "center",
    ranges: {
       "All": [minMoment, maxMoment],
       "Last 30 Days": [moment.utc(maxMoment).subtract(30, "days").format("YYYY-MM-DD"), endMoment],
       "Last 7 Days": [moment.utc(maxMoment).subtract(6, "days").format("YYYY-MM-DD"), endMoment],
    },
  }, function(chosenStartMoment, chosenEndMoment, label) {
    updateDateRange(gCurrentDateRangeUpdateCallback, evolutions, true);
  });
  
  // First load, update the date picker from the page state
  if (!gLoadedDateRangeFromState && gInitialPageState.start_date !== null && gInitialPageState.end_date !== null) {
    gLoadedDateRangeFromState = true;
    var startMoment = gInitialPageState.start_date, endMoment = gInitialPageState.end_date;
    if (moment.utc(startMoment).isValid() && moment.utc(endMoment).isValid()) {
      picker.setStartDate(startMoment);
      picker.setEndDate(endMoment);
      gPreviousMinMoment = minMoment; gPreviousMaxMoment = maxMoment;
    }
    
    // If advanced settings are not at their defaults, expand the settings pane on load
    if (gInitialPageState.use_submission_date !== 0 || gInitialPageState.cumulative !== 0 ||
      startMoment !== minMoment || endMoment !== maxMoment) {
      $("#advanced-settings-toggle").click();
    }
  }
  
  // If the selected date range is now out of bounds, or the bounds were updated programmatically and changed, select the entire range
  var pickerStartDate = picker.startDate.format("YYYY-MM-DD");
  var pickerEndDate = picker.endDate.format("YYYY-MM-DD");
  if (pickerStartDate > maxMoment || pickerStartDate < minMoment || pickerEndDate > maxMoment || pickerEndDate < minMoment ||
    (!updatedByUser && (minMoment !== gPreviousMinMoment || maxMoment !== gPreviousMaxMoment))) {
    picker.setStartDate(minMoment); picker.setEndDate(maxMoment);
    pickerStartDate = minMoment; pickerEndDate = maxMoment;
  }
  gPreviousMinMoment = minMoment; gPreviousMaxMoment = maxMoment;
  
  // Rebuild rangebar if it was changed by something other than the user
  if (shouldUpdateRangebar) {
    var rangeBarControl = RangeBar({
      min: minMoment, max: moment(maxMoment).add(1, "days").format("YYYY-MM-DD"),
      maxRanges: 1,
      valueFormat: function(ts) { return ts; },
      valueParse: function(date) { return moment.utc(date).valueOf(); },
      label: function(a) {
        var days = (a[1] - a[0]) / 86400000;
        return days < 5 ? days : moment.utc(a[1]).from(a[0], true);
      },
      snap: 1000 * 60 * 60 * 24, minSize: 1000 * 60 * 60 * 24, bgLabels: 0,
    }).on("changing", function(e, ranges, changed) {
      var range = ranges[0];
      if (gLastTimeoutID !== null) { clearTimeout(gLastTimeoutID); }
      gLastTimeoutID = setTimeout(function() { // Debounce slider movement callback
        picker.setStartDate(moment.utc(range[0]).format("YYYY-MM-DD"))
        picker.setEndDate(moment.utc(range[1]).subtract(1, "days").format("YYYY-MM-DD"));
        updateDateRange(gCurrentDateRangeUpdateCallback, evolutions, true, false);
      }, 50);
    });
    $("#range-bar").empty().append(rangeBarControl.$el);
    var dateControls = $("#date-range-controls");
    $("#range-bar").outerWidth(dateControls.parent().width() - dateControls.outerWidth() - 10);
    rangeBarControl.val([[moment(pickerStartDate).toDate(), moment(pickerEndDate).add(1, "days").toDate()]]);
  }
  
  var min = moment.utc(pickerStartDate).toDate(), max = moment.utc(pickerEndDate).toDate();
  dates = dates.filter(function(date) { return min <= date && date <= max; });
  
  if (dates.length == 0) {
    if (evolutions[0].dates().length === 0) {
      $("#date-range").prop("disabled", true);
      $("#range-bar").hide();
    }
    gCurrentDateRangeUpdateCallback(null);
  } else {
    gCurrentDateRangeUpdateCallback(filteredDates);
  }
}

function displayHistograms(histogramsList, dates, cumulative) {
  cumulative = cumulative || false;
  var axesList = [$("#distribution1").get(0), $("#distribution2").get(0), $("#distribution3").get(0), $("#distribution4").get(0)];
  
  if (histogramsList.length === 1) { // Only one histograms set
    if (histogramsList[0].histograms.length === 1) { // Only one histogram in histograms set
      var histogram = histogramsList[0].histograms[0];
      $("#prop-kind").text(histogram.kind);
      $("#prop-dates").text(formatNumber(dates.length));
      $("#prop-date-range").text(moment.utc(dates[0]).format("YYYY/MM/DD") + ((dates.length == 1) ? "" : " to " + moment.utc(dates[dates.length - 1]).format("YYYY/MM/DD")));
      $("#prop-submissions").text(formatNumber(histogram.submissions));
      $("#prop-count").text(formatNumber(histogram.count));
      $("#prop-sum").text(formatNumber(histogram.sum));
      if (histogram.kind == "linear" || histogram.kind == "exponential") {
        $("#prop-p5").text(formatNumber(histogram.percentile(5)));
        $("#prop-p25").text(formatNumber(histogram.percentile(25)));
        $("#prop-p50").text(formatNumber(histogram.percentile(50)));
        $("#prop-p75").text(formatNumber(histogram.percentile(75)));
        $("#prop-p95").text(formatNumber(histogram.percentile(95)));
        $(".scalar-only").show();
      } else {
        $(".scalar-only").hide();
      }
      $("#summary").show();
    } else {
      $("#summary").hide();
    }
    
    $("#distribution").parent().parent().show();
    axesList.forEach(function(axes, i) { $(axes).parent().parent().hide(); });
    displaySingleHistogramSet($("#distribution").get(0), histogramsList[0].histograms, 1, histogramsList[0].title, cumulative);
  }
  else { // Multiple histograms, each one keyed
    $("#summary").hide();
    
    $("#distribution").parent().parent().hide();
    axesList.forEach(function(axes, i) {
      $(axes).parent().parent().show();
      var entry = histogramsList[i] || null;
      if (entry !== null) {
        displaySingleHistogramSet(axes, entry.histograms, entry.title, cumulative);
      } else {
        displaySingleHistogramSet(axes, [], null, cumulative);
      }
    });
  }
}

function displaySingleHistogramSet(axes, histograms, title, cumulative) {
  // No histograms available
  if (histograms.length === 0) {
    MG.data_graphic({
      chart_type: "missing-data",
      full_width: true, height: $(axes).width() * 0.4,
      target: axes,
    });
    $(axes).find(".mg-missing-pane").remove();
    return;
  }
  
  // All histograms must have the same buckets and be of the same kind
  var starts = histograms[0].map(function(count, start, end, i) { return start; });
  var ends = histograms[0].map(function(count, start, end, i) { return end; });
  ends[ends.length - 1] = Infinity;
  var countsList = histograms.map(function(histogram) {
    return histogram.map(function(count, start, end, i) { return count; });
  });
  if (cumulative) { // Show cumulative histogram by adding up all the previous data points
    countsList = countsList.map(function(counts) {
      var total = 0;
      return counts.map(function(count) { return total += count; });
    });
  }

  var distributionSamples = countsList.map(function(counts, i) {
    return counts.map(function(count, j) { return {value: j, count: (count / histograms[i].count) * 100}; });
  });
  
  // Plot the data using MetricsGraphics
  if (histograms.length === 1) { // One histogram available, display as histogram
    var histogram = histograms[0];
    MG.data_graphic({
      data: distributionSamples[0],
      binned: true,
      chart_type: "histogram",
      full_width: true, height: $(axes).width() * 0.4,
      left: 150, right: $(axes).width() / (distributionSamples[0].length + 1) + 150,
      transition_on_update: false,
      target: axes,
      x_label: histogram.description, y_label: "Percentage of Samples",
      xax_ticks: 20,
      y_extended_ticks: true,
      x_accessor: "value", y_accessor: "count",
      xax_format: function(index) { return formatNumber(starts[index]); },
      yax_format: function(value) { return value + "%"; },
      mouseover: function(d, i) {
        var count = formatNumber(countsList[0][d.x]), percentage = Math.round(d.y * 100) / 100 + "%";
        var label;
        if (ends[d.x] === Infinity) {
         label = histogram.measure + ": " + count + " samples (" + percentage + ") where sample value \u2265 " + formatNumber(cumulative ? 0 : starts[d.x]);
        } else {
         label = histogram.measure + ": " + count + " samples (" + percentage + ") where " + formatNumber(cumulative ? 0 : starts[d.x]) + " \u2264 sample value < " + formatNumber(ends[d.x]);
        }

        var offset = $(axes).find(".mg-bar:nth-child(" + (i + 1) + ")").get(0).getAttribute("transform");
        var barWidth = $(axes).find(".mg-bar:nth-child(" + (i + 1) + ") rect").get(0).getAttribute("width");
        
        // Reposition element
        var legend = d3.select(axes).select(".mg-active-datapoint").text(label).attr("transform", offset)
          .attr("x", barWidth / 2).attr("y", "0").attr("dy", "-10").attr("text-anchor", "middle").style("fill", "white");
        var bbox = legend[0][0].getBBox();
        var padding = 5;
        
        // Add background
        d3.select(axes).select(".active-datapoint-background").remove(); // Remove old background
        d3.select(axes).select("svg").insert("rect", ".mg-active-datapoint").classed("active-datapoint-background", true)
          .attr("x", bbox.x - padding).attr("y", bbox.y - padding).attr("transform", offset)
          .attr("width", bbox.width + padding * 2).attr("height", bbox.height + padding * 2)
          .attr("rx", "3").attr("ry", "3").style("fill", "#333");
      },
      mouseout: function(d, i) {
        d3.select(axes).select(".active-datapoint-background").remove(); // Remove old background
      },
    });
    
    // Extend the Y axis ticks to cover the last bucket
    var barWidth = parseFloat($(axes).find(".mg-rollover-rects:last-child rect").attr("width"))
    $(axes).find(".mg-extended-y-ticks").each(function(i, yTick) {
      var x2 = parseFloat(yTick.attributes.x2.value) + barWidth;
      yTick.setAttribute("x2", x2);
    });
  } else { // Multiple histograms available, display as overlaid lines
    MG.data_graphic({
      data: distributionSamples,
      chart_type: "line",
      full_width: true, height: 600,
      left: 150, right: 150,
      transition_on_update: false,
      target: axes,
      x_label: histograms[0].description, y_label: "Percentage of Samples",
      xax_ticks: 20,
      y_extended_ticks: true,
      x_accessor: "value", y_accessor: "count",
      xax_format: function(index) { return formatNumber(starts[index]); },
      yax_format: function(value) { return value + "%"; },
      mouseover: function(d, i) {
        var rolloverCircle = $(axes).find(".mg-line-rollover-circle.mg-area" + d.line_id + "-color").get(0);
        var histogram = histograms[d.line_id - 1];
        var count = formatNumber(countsList[d.line_id - 1][d.value]), percentage = Math.round(d.count * 100) / 100 + "%";
        var label;
        if (ends[d.value] === Infinity) {
         label = count + " samples (" + percentage + " of all " + histogram.measure + ") where sample value \u2265 " + formatNumber(cumulative ? 0 : starts[d.value]);
        } else {
         label = count + " samples (" + percentage + " of all " + histogram.measure + ") where " + formatNumber(cumulative ? 0 : starts[d.value]) + " \u2264 sample value < " + formatNumber(ends[d.value]);
        }
        var legend = d3.select(axes).select(".mg-active-datapoint").text(label).style("fill", "white");
        
        // Reposition element
        var x = parseInt(rolloverCircle.getAttribute("cx")) + 20, y = 40;
        var bbox = legend[0][0].getBBox();
        if (x + bbox.width + 50 > $(axes).find("svg").width()) x -= bbox.width + 40;
        d3.select(axes).select(".mg-active-datapoint-container").attr("transform", "translate(" + (x + bbox.width) + "," + (y + 15) + ")");
        
        // Add background
        var padding = 10;
        d3.select(axes).select(".active-datapoint-background").remove(); // Remove old background
        d3.select(axes).select("svg").insert("rect", ".mg-active-datapoint-container").classed("active-datapoint-background", true)
          .attr("x", x - padding).attr("y", y)
          .attr("width", bbox.width + padding * 2).attr("height", bbox.height + 8)
          .attr("rx", "3").attr("ry", "3").style("fill", "#333");
      },
      mouseout: function(d, i) {
        d3.select(axes).select(".active-datapoint-background").remove(); // Remove old background
      },
    });
  }
  
    // Reposition and resize text
  $(axes).find(".mg-x-axis .label").attr("dy", "1.2em");
  $(axes).find(".mg-x-axis text:not(.label)").each(function(i, text) { // Axis tick labels
    if ($(text).text() === "NaN") { text.parentNode.removeChild(text); } // Remove "NaN" labels resulting from interpolation in histogram labels
    $(text).attr("dx", "0.3em").attr("dy", "0").attr("text-anchor", "start");
  });
  $(axes).find(".mg-x-axis line").each(function(i, tick) { // Extend axis ticks to 15 pixels
    $(tick).attr("y2", parseInt($(tick).attr("y1")) + 12);
  });
  $(axes).find(".mg-y-axis .label").attr("y", "90").attr("dy", "0");
}

// Save the current state to the URL and the page cookie
var gPreviousCSVBlobUrl = null, gPreviousJSONBlobUrl = null;
function saveStateToUrlAndCookie() {
  var picker = $("#date-range").data("daterangepicker");
  gInitialPageState = {
    measure: $("#measure").val(),
    max_channel_version: $("#channel-version").val(),
    product: $("#filter-product").val() || [],
    compare: $("#compare").val(),
    cumulative: $("input[name=cumulative-toggle]:checked").val() !== "0" ? 1 : 0,
    use_submission_date: $("input[name=build-time-toggle]:checked").val() !== "0" ? 1 : 0,
    sanitize: $("input[name=sanitize-toggle]:checked").val() !== "0" ? 1 : 0,
    start_date: moment(picker.startDate).format("YYYY-MM-DD"),
    end_date: moment(picker.endDate).format("YYYY-MM-DD"),
    
    // Save a few unused properties that are used in the evolution dashboard, since state is shared between the two dashboards
    min_channel_version: gInitialPageState.min_channel_version !== undefined ?
      gInitialPageState.min_channel_version : "nightly/38",
  };
  
  // Only store these in the state if they are not all selected
  var selected = $("#filter-os").val() || [];
  if (selected.length !== $("#filter-os option").size()) { gInitialPageState.os = compressOSs(); }
  var selected = $("#filter-arch").val() || [];
  if (selected.length !== $("#filter-arch option").size()) { gInitialPageState.arch = selected; }
  var selected = $("#filter-e10s").val() || [];
  if (selected.length !== $("#filter-e10s option").size()) { gInitialPageState.e10s = selected; }
  var selected = $("#filter-process-type").val() || [];
  if (selected.length !== $("#filter-process-type option").size()) { gInitialPageState.processType = selected; }
  
  var fragments = [];
  $.each(gInitialPageState, function(k, v) {
    if ($.isArray(v)) {
      v = v.join("!");
    }
    fragments.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
  });
  var stateString = fragments.join("&");
  
  // Save to the URL hash if it changed
  var url = window.location.hash;
  url = url[0] === "#" ? url.slice(1) : url;
  if (url !== stateString) {
    window.location.replace(window.location.origin + window.location.pathname + "#" + encodeURI(stateString));
    $(".permalink-control input").hide(); // Hide the permalink box again since the URL changed
  }

  
  // Save the state in a cookie that expires in 3 days
  var expiry = new Date();
  expiry.setTime(expiry.getTime() + (3 * 24 * 60 * 60 * 1000));
  document.cookie = "stateFromUrl=" + stateString + "; expires=" + expiry.toGMTString();
  
  // Add link to switch to the evolution dashboard with the same settings
  var dashboardURL = window.location.origin + window.location.pathname.replace(/dist\.html$/, "evo.html") + window.location.hash;
  $("#switch-views").attr("href", dashboardURL);
  
  // Update export links with the new histogram
  if (gCurrentHistogramsList.length > 0 && gCurrentHistogramsList[0].length === 1) { // wip: remove this
    if (gPreviousCSVBlobUrl !== null) { URL.revokeObjectURL(gPreviousCSVBlobUrl); }
    if (gPreviousJSONBlobUrl !== null) { URL.revokeObjectURL(gPreviousJSONBlobUrl); }
    var csvValue = "start,\tcount\n" + gCurrentHistogramsList[0].map(function (count, start, end, i) { return start + ",\t" + count; }).join("\n");
    var jsonValue = JSON.stringify(gCurrentHistogramsList[0].map(function(count, start, end, i) { return {start: start, count: count} }));
    gPreviousCSVBlobUrl = URL.createObjectURL(new Blob([csvValue]));
    gPreviousJSONBlobUrl = URL.createObjectURL(new Blob([jsonValue]));
    $("#export-csv").attr("href", gPreviousCSVBlobUrl).attr("download", gCurrentHistogramsList[0][0].measure + ".csv");
    $("#export-json").attr("href", gPreviousJSONBlobUrl).attr("download", gCurrentHistogramsList[0][0].measure + ".json");
  } else {
    $("#export-csv, #export-json").hide();
  }
  
  // If advanced settings are not at their defaults, display a notice in the panel header
  var start = gInitialPageState.start_date, end = gInitialPageState.end_date;
  if (gCurrentMinDate !== null) {
    var minMoment = gCurrentMinDate, maxMoment = gCurrentMaxDate;
  } else {
    var minMoment = start, maxMoment = end;
  }
  
  if (gInitialPageState.use_submission_date !== 0 || gInitialPageState.cumulative !== 0 || start !== minMoment || end !== maxMoment) {
    $("#advanced-settings-toggle").find("span").text(" (modified)");
  } else {
    $("#advanced-settings-toggle").find("span").text("");
  }
}
