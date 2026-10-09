<script lang="ts">
	import { resolve } from "$app/paths";
	import Page from "$lib/components/Page.svelte";
</script>

<svelte:head><title>About · Physics Quiz</title></svelte:head>

<Page narrow>
	<ol class="breadcrumb">
		<li><a href={resolve("/")}>Home</a></li>
		<li>About</li>
	</ol>
	<div class="page-header">
		<h1>About</h1>
	</div>

	<p>
		Hello! I'm <b>@omgaxd</b>. I made this to help people (including myself) get better at <b>phys161</b>.
	</p>
	<p>
		I believe that to be prepared for the exam, <a href="https://youtu.be/XDbEAs11boo"
			>one needs to write the exam many times beforehand</a
		>. Just learning the problems by heart isn't enough for me: I can forget a unit, I can mistype from the
		calculator, etc.
	</p>
	<em
		>I want to make all these mistakes a thousand times in a safe environment, so that I make zero mistakes in the
		actual exam.</em
	>
	<p>
		This app is mostly vibecoded, but I've reviewed the code and made sure it's up to my vision. Also, this text is
		written by hand. If you're curious, here are the features that I care about:
	</p>
	<ul>
		<li>
			<b>Nearly one-to-one to the actual exam.</b> The theme is like in Moodle, the answer box with preview is like
			in Moodle, the buttons are like in Moodle.
		</li>
		<li>
			<b>Randomised problems.</b> I've employed LLMs to review the problems from our Exam sets & to translate them
			to a format that my quiz engine understands. So, just like on the real exam, you can meet the same problem with
			different values.
		</li>
		<li>
			<b>Shareable settings.</b> Maybe you want to compete with your friends? Set up the exam in the way you like,
			click "Copy link" and you will have the exact same exam, down to the problems.
		</li>
		<li>
			<b>Saving the state.</b> <a href="https://en.touhouwiki.net/Fujiwara_no_Mokou">My friend</a> asked for this
			feature. You can press the mysterious "Export state" button in the left sidebar to download a .json file, and
			later import it in another browser or on another device to restore your settings and/or which problems you've
			solved.
		</li>
	</ul>
	<p>
		If you have a suggestion, feel free to click "Feedback" on the left, it'll take you to GitHub so you can create
		an Issue. Write your feedback / suggestion / bug report there.
	</p>
	<p>
		For the devs: know that this app's source code is under the <b>MIT</b> license. You may take ANY part of it for your
		own projects and purposes. Crediting me is appreciated, but optional.
	</p>
	<p>Alternatively, if you want to contribute, reach out to me on Telegram.</p>
  <a href={resolve("/")}>To Home</a>
</Page>
