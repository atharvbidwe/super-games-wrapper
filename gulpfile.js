var gulp = require("gulp");

let map = require('@flairlabs/gulp-utils')

map.forEach((task) => {
    gulp.task(task.functionName, gulp.series(task.fn))
});